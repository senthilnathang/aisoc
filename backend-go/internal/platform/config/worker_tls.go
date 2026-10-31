package config

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"os"
	"strconv"
)

// WorkerTLS is optional only for literal-loopback development. There is no
// insecure-skip-verify option. A dedicated worker CA and client certificate are required.
type WorkerTLS struct{ CAFile, CertFile, KeyFile, ServerName string }

func (c WorkerTLS) Enabled() bool {
	return c.CAFile != "" || c.CertFile != "" || c.KeyFile != "" || c.ServerName != ""
}
func (c WorkerTLS) Validate(address string) error {
	if !c.Enabled() {
		return Loopback(address)
	}
	if c.CAFile == "" || c.CertFile == "" || c.KeyFile == "" || c.ServerName == "" {
		return errors.New("all worker TLS settings are required")
	}
	host, port, err := net.SplitHostPort(address)
	n, e := strconv.Atoi(port)
	if err != nil || host == "" || e != nil || n < 1 || n > 65535 {
		return errors.New("invalid TLS worker address")
	}
	return nil
}
func (c WorkerTLS) ClientConfig() (*tls.Config, error) {
	ca, err := os.ReadFile(c.CAFile)
	if err != nil {
		return nil, errors.New("cannot read worker CA")
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(ca) {
		return nil, errors.New("invalid worker CA")
	}
	cert, err := tls.LoadX509KeyPair(c.CertFile, c.KeyFile)
	if err != nil {
		return nil, errors.New("invalid worker client certificate/key")
	}
	return &tls.Config{RootCAs: roots, Certificates: []tls.Certificate{cert}, ServerName: c.ServerName, MinVersion: tls.VersionTLS12}, nil
}
