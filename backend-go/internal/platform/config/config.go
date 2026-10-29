package config

import (
	"encoding/hex"
	"errors"
	"net"
	"os"
	"strconv"
)

type Config struct {
	ConnectorKey                                                  []byte
	Auth                                                          Auth
	Address, DatabaseURL, PythonAddress, RustAddress, WorkerToken string
	PoolSize                                                      int32
}

func Load() (Config, error) {
	c := Config{Address: value("AISOC_GO_ADDR", "127.0.0.1:3003"), DatabaseURL: os.Getenv("AISOC_GO_DATABASE_URL"), PythonAddress: os.Getenv("AISOC_PYTHON_ADDR"), RustAddress: os.Getenv("AISOC_RUST_ADDR"), WorkerToken: os.Getenv("AISOC_WORKER_TOKEN")}
	if err := Loopback(c.Address); err != nil {
		return c, err
	}
	_, port, _ := net.SplitHostPort(c.Address)
	if port == "8080" || (port == "3002" && os.Getenv("AISOC_GO_RELEASE_MODE") != "true") {
		return c, errors.New("active application ports are reserved")
	}
	if c.DatabaseURL == "" {
		return c, errors.New("AISOC_GO_DATABASE_URL is required; use an isolated PostgreSQL database")
	}
	if raw := os.Getenv("AISOC_GO_CONNECTOR_KEY"); raw != "" {
		key, err := hex.DecodeString(raw)
		if err != nil || len(key) != 32 {
			return c, errors.New("AISOC_GO_CONNECTOR_KEY must be a 64-character hexadecimal key")
		}
		c.ConnectorKey = key
	}
	n, err := strconv.Atoi(value("AISOC_GO_POOL_SIZE", "8"))
	if err != nil || n < 1 || n > 64 {
		return c, errors.New("AISOC_GO_POOL_SIZE must be 1..64")
	}
	c.PoolSize = int32(n)
	c.Auth, err = loadAuth()
	if err != nil {
		return c, err
	}
	for _, address := range []string{c.PythonAddress, c.RustAddress} {
		if address != "" {
			if err := Loopback(address); err != nil {
				return c, err
			}
			if len(c.WorkerToken) < 32 {
				return c, errors.New("AISOC_WORKER_TOKEN must contain at least 32 characters when workers are configured")
			}
		}
	}
	return c, nil
}

// Plaintext RPC is confined to literal loopback during framework development.
// Remote deployment requires a later authenticated TLS transport configuration.
func Loopback(address string) error {
	host, port, err := net.SplitHostPort(address)
	ip := net.ParseIP(host)
	n, parseErr := strconv.Atoi(port)
	if err != nil || ip == nil || !ip.IsLoopback() || parseErr != nil || n < 1 || n > 65535 {
		return errors.New("address must be a literal loopback IP and valid port")
	}
	return nil
}
func value(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
