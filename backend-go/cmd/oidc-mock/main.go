// Disposable development IdP. Deliberately accepts synthetic identities only.
package main

import (
	"aisoc/backend/internal/platform/config"
	"aisoc/backend/internal/platform/oidcmock"
	"log"
	"net/http"
	"os"
	"time"
)

func main() {
	addr := os.Getenv("AISOC_MOCK_OIDC_ADDR")
	if os.Getenv("AISOC_GO_ENV") == "production" || config.Loopback(addr) != nil || os.Getenv("AISOC_MOCK_OIDC_ENABLE") != "true" {
		log.Fatal("mock IdP requires explicit local enablement and loopback binding")
	}
	p, e := oidcmock.New("http://"+addr, "aisoc-local", os.Getenv("AISOC_MOCK_OIDC_REDIRECT"))
	if e != nil {
		log.Fatal("mock initialization failed")
	}
	s := http.Server{Addr: addr, Handler: p, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16384}
	log.Fatal(s.ListenAndServe())
}
