package connectors

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/json"
	"testing"
)

func decrypt(key, envelope []byte, tenant, id string) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	aad, _ := json.Marshal([]string{tenant, id})
	return gcm.Open(nil, envelope[1:1+gcm.NonceSize()], envelope[1+gcm.NonceSize():], aad)
}
func TestSecretEncryption(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	a, err := seal(key, "tenant", "id", "fixture-secret")
	if err != nil {
		t.Fatal(err)
	}
	b, err := seal(key, "tenant", "id", "fixture-secret")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(a, b) || bytes.Contains(a, []byte("fixture-secret")) || a[0] != 1 {
		t.Fatal("invalid envelope")
	}
	plain, err := decrypt(key, a, "tenant", "id")
	if err != nil || string(plain) != "fixture-secret" {
		t.Fatal("decryption failed")
	}
	for _, pair := range [][2]string{{"other", "id"}, {"tenant", "other"}} {
		if _, err = decrypt(key, a, pair[0], pair[1]); err == nil {
			t.Fatal("identity substitution accepted")
		}
	}
	if _, err = decrypt(bytes.Repeat([]byte{8}, 32), a, "tenant", "id"); err == nil {
		t.Fatal("wrong key accepted")
	}
	a[len(a)-1] ^= 1
	if _, err = decrypt(key, a, "tenant", "id"); err == nil {
		t.Fatal("tampering accepted")
	}
	if _, err = seal(nil, "tenant", "id", "secret"); err == nil {
		t.Fatal("missing key accepted")
	}
	if v, err := seal(nil, "tenant", "id", ""); err != nil || v != nil {
		t.Fatal("clear failed")
	}
}
