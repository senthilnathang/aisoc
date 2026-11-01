package config

import (
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"regexp"
)

type OIDC struct {
	Issuer           string `json:"issuer"`
	ClientID         string `json:"client_id"`
	ClientSecret     string `json:"-"`
	ClientSecretFile string `json:"client_secret_file"`
	RedirectURL      string `json:"redirect_url"`
	MappingsFile     string `json:"mappings_file"`
	LocalMock        bool   `json:"local_mock"`
}
type IdentityMapping struct {
	Subject    string   `json:"subject"`
	OperatorID string   `json:"operator_id"`
	TenantID   string   `json:"tenant_id"`
	Roles      []string `json:"roles"`
	Generation int      `json:"generation"`
	Disabled   bool     `json:"disabled"`
}

func ReadPrivateJSON(path string, out any) error {
	f, e := os.Open(path)
	if e != nil {
		return errors.New("cannot read identity configuration")
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil || !info.Mode().IsRegular() || info.Size() > 1048576 || info.Mode().Perm()&0022 != 0 {
		return errors.New("identity configuration must be a bounded, non-writable-by-others regular file")
	}
	d := json.NewDecoder(io.LimitReader(f, 1048577))
	d.DisallowUnknownFields()
	if e = d.Decode(out); e != nil {
		return errors.New("invalid identity configuration")
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("invalid identity configuration")
	}
	return nil
}
func (o OIDC) Mappings() ([]IdentityMapping, error) {
	var list []IdentityMapping
	if e := ReadPrivateJSON(o.MappingsFile, &list); e != nil {
		return nil, e
	}
	if len(list) == 0 || len(list) > 100 {
		return nil, errors.New("identity mappings require 1..100 subjects")
	}
	ids, subjects := map[string]bool{}, map[string]bool{}
	id := regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$`)
	for _, m := range list {
		if m.Subject == "" || len(m.Subject) > 255 || !id.MatchString(m.OperatorID) || m.OperatorID == "local-development" || !id.MatchString(m.TenantID) || m.Generation < 1 || ids[m.OperatorID] || subjects[m.Subject] {
			return nil, errors.New("invalid or ambiguous identity mapping")
		}
		roles := map[string]bool{}
		for _, r := range m.Roles {
			if (r != "proposer" && r != "approver" && r != "executor") || roles[r] {
				return nil, errors.New("invalid mapped role")
			}
			roles[r] = true
		}
		ids[m.OperatorID] = true
		subjects[m.Subject] = true
	}
	return list, nil
}
func (o OIDC) Validate(origins []string) error {
	issuer, e := url.Parse(o.Issuer)
	if e != nil || issuer.Host == "" || issuer.User != nil || issuer.RawQuery != "" || issuer.Fragment != "" {
		return errors.New("invalid OIDC issuer")
	}
	callback, e := url.Parse(o.RedirectURL)
	if e != nil || callback.Host == "" || callback.User != nil || callback.RawQuery != "" || callback.Fragment != "" || callback.Path != "/api/v1/auth/oidc/callback" {
		return errors.New("invalid OIDC callback")
	}
	for _, u := range []*url.URL{issuer, callback} {
		if u.Scheme != "https" && !(o.LocalMock && u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost")) {
			return errors.New("OIDC requires HTTPS, except explicit loopback mock mode")
		}
	}
	allowed := false
	for _, origin := range origins {
		if callback.Scheme+"://"+callback.Host == origin {
			allowed = true
		}
	}
	if !allowed || o.ClientID == "" || len(o.ClientID) > 200 {
		return errors.New("OIDC callback must use an allowed application origin and client ID")
	}
	_, e = o.Mappings()
	return e
}
