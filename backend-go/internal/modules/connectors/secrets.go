package connectors

import (
	"aisoc/backend/internal/platform/fault"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"errors"
)

// EncryptSecret is used by the offline importer, using the same identity-bound
// envelope as API writes. DecryptSecret is restricted to offline export tooling.
func EncryptSecret(key []byte, tenant, id, secret string) ([]byte, error) {
	return seal(key, tenant, id, secret)
}
func DecryptSecret(key, envelope []byte, tenant, id string) (string, error) {
	if len(envelope) == 0 {
		return "", nil
	}
	if len(key) != 32 {
		return "", errors.New("connector decryption key unavailable")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(envelope) < 1+gcm.NonceSize()+gcm.Overhead() || envelope[0] != 1 {
		return "", errors.New("invalid credential envelope")
	}
	aad, _ := json.Marshal([]string{tenant, id})
	plain, err := gcm.Open(nil, envelope[1:1+gcm.NonceSize()], envelope[1+gcm.NonceSize():], aad)
	if err != nil {
		return "", errors.New("connector decryption failed")
	}
	return string(plain), nil
}

// Version byte, random GCM nonce, authenticated ciphertext. Tenant and connector
// identity are authenticated so a copied envelope cannot bind to another record.
func seal(key []byte, tenant, id, secret string) ([]byte, error) {
	if secret == "" {
		return nil, nil
	}
	if len(key) != 32 {
		return nil, fault.New(503, "CONNECTOR_KEY_UNAVAILABLE", "Connector credential encryption is not configured.")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	envelope := make([]byte, 1+gcm.NonceSize())
	envelope[0] = 1
	if _, err = rand.Read(envelope[1:]); err != nil {
		return nil, err
	}
	aad, _ := json.Marshal([]string{tenant, id})
	return gcm.Seal(envelope, envelope[1:], []byte(secret), aad), nil
}
