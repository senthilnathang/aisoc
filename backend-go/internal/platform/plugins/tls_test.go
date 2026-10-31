package plugins

import (
	"aisoc/backend/internal/platform/config"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMutualTLSIdentity(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "test-ca"}, IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign, NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour)}
	der, err := x509.CreateCertificate(rand.Reader, ca, ca, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	caFile := filepath.Join(dir, "ca.pem")
	os.WriteFile(caFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0600)
	leaf := &x509.Certificate{SerialNumber: big.NewInt(2), DNSNames: []string{"worker.test"}, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth}, NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour)}
	der, err = x509.CreateCertificate(rand.Reader, leaf, ca, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certFile, keyFile := filepath.Join(dir, "cert.pem"), filepath.Join(dir, "key.pem")
	os.WriteFile(certFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0600)
	kd, _ := x509.MarshalECPrivateKey(key)
	os.WriteFile(keyFile, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kd}), 0600)
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	raw, _ := os.ReadFile(caFile)
	roots.AppendCertsFromPEM(raw)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := grpc.NewServer(grpc.Creds(credentials.NewTLS(&tls.Config{Certificates: []tls.Certificate{cert}, ClientCAs: roots, ClientAuth: tls.RequireAndVerifyClientCert, MinVersion: tls.VersionTLS12})))
	h := health.NewServer()
	h.SetServingStatus("aisoc.worker.v1.Worker", healthpb.HealthCheckResponse_SERVING)
	healthpb.RegisterHealthServer(server, h)
	go server.Serve(listener)
	defer server.Stop()
	settings := config.WorkerTLS{CAFile: caFile, CertFile: certFile, KeyFile: keyFile, ServerName: "worker.test"}
	c, err := NewWithTLS(listener.Addr().String(), "01234567890123456789012345678901", settings)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if err = c.CheckHealth(context.Background()); err != nil {
		t.Fatal(err)
	}
	settings.ServerName = "wrong.test"
	bad, err := NewWithTLS(listener.Addr().String(), "01234567890123456789012345678901", settings)
	if err != nil {
		t.Fatal(err)
	}
	defer bad.Close()
	if bad.CheckHealth(context.Background()) == nil {
		t.Fatal("wrong server identity accepted")
	}
	otherKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	otherCA, err := x509.CreateCertificate(rand.Reader, ca, ca, &otherKey.PublicKey, otherKey)
	if err != nil {
		t.Fatal(err)
	}
	otherFile := filepath.Join(dir, "other-ca.pem")
	if err = os.WriteFile(otherFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: otherCA}), 0600); err != nil {
		t.Fatal(err)
	}
	settings.ServerName = "worker.test"
	settings.CAFile = otherFile
	untrusted, err := NewWithTLS(listener.Addr().String(), "01234567890123456789012345678901", settings)
	if err != nil {
		t.Fatal(err)
	}
	defer untrusted.Close()
	if untrusted.CheckHealth(context.Background()) == nil {
		t.Fatal("untrusted worker CA accepted")
	}
	settings.CertFile = ""
	if _, err = NewWithTLS(listener.Addr().String(), "01234567890123456789012345678901", settings); err == nil {
		t.Fatal("partial TLS accepted")
	}
	if _, err = New("worker.test:50051", "01234567890123456789012345678901"); err == nil {
		t.Fatal("remote plaintext accepted")
	}
}
