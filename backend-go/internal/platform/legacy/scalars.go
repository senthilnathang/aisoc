// Package legacy contains the tested scalar conversions needed by the SQLite API contract.
package legacy

import (
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
)

var errScalar = errors.New("unsupported legacy scalar")
var decimal = regexp.MustCompile(`^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)

// Text matches SQLite text affinity for JSON strings and ordinary finite numbers
// bound by Node as doubles. Nulls, booleans and composite values are not text.
func Text(raw json.RawMessage) (string, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", errScalar
	}
	switch v := value.(type) {
	case string:
		return v, nil
	case float64:
		if math.IsInf(v, 0) || math.IsNaN(v) {
			return "", errScalar
		}
		if v == 0 {
			return "0.0", nil
		}
		text := strconv.FormatFloat(v, 'g', 15, 64)
		parts := strings.SplitN(text, "e", 2)
		if !strings.Contains(parts[0], ".") {
			parts[0] += ".0"
		}
		return strings.Join(parts, "e"), nil
	default:
		return "", errScalar
	}
}

// Integer accepts an integral JSON number or a decimal numeric string, while
// retaining the PostgreSQL int32 boundary. It never coerces bool/null to zero.
func Integer(raw json.RawMessage) (int32, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, errScalar
	}
	var n float64
	switch v := value.(type) {
	case float64:
		n = v
	case string:
		v = strings.TrimSpace(v)
		if !decimal.MatchString(v) {
			return 0, errScalar
		}
		var err error
		n, err = strconv.ParseFloat(v, 64)
		if err != nil {
			return 0, errScalar
		}
	default:
		return 0, errScalar
	}
	if math.IsNaN(n) || math.IsInf(n, 0) || math.Trunc(n) != n || n < math.MinInt32 || n > math.MaxInt32 {
		return 0, errScalar
	}
	return int32(n), nil
}
