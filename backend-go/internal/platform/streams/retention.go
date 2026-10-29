package streams

import (
	"aisoc/backend/internal/modules/telemetry"
	"context"
	"time"
)

const retireScript = `
local entry=redis.call('XRANGE',KEYS[1],ARGV[2],ARGV[2],'COUNT',1)
if #entry==0 then return 'missing' end
local values=entry[1][2]; local key=nil;local hash=nil
for i=1,#values,2 do if values[i]=='event_key' then key=values[i+1] end if values[i]=='content_hash' then hash=values[i+1] end end
if key~=ARGV[3] or hash~=ARGV[4] then return 'changed' end
local groups=redis.call('XINFO','GROUPS',KEYS[1])
if #groups~=1 then return 'group_mismatch' end
local name=nil
for i=1,#groups[1],2 do if groups[1][i]=='name' then name=groups[1][i+1] end end
if name~=ARGV[1] then return 'group_mismatch' end
if #redis.call('XPENDING',KEYS[1],ARGV[1],ARGV[2],ARGV[2],1)>0 then return 'pending' end
local now=redis.call('TIME');local millis=tonumber(string.match(ARGV[2],'^([0-9]+)-'))
if millis>tonumber(now[1])*1000+math.floor(tonumber(now[2])/1000)-tonumber(ARGV[5]) then return 'young' end
redis.call('XDEL',KEYS[1],ARGV[2]);return 'removed'
`

func (c *Client) Page(ctx context.Context, b telemetry.Binding, after string) ([]Delivery, error) {
	key, err := Key(b)
	if err != nil {
		return nil, err
	}
	start := "-"
	if after != "" {
		if len(after) > 128 || !idPattern.MatchString(after) {
			return nil, ErrInvalid
		}
		start = "(" + after
	}
	ctx, cancel := bounded(ctx)
	defer cancel()
	entries, err := c.redis.XRangeN(ctx, key, start, "+", 100).Result()
	if err != nil {
		return nil, err
	}
	result := make([]Delivery, 0, len(entries))
	for _, e := range entries {
		result = append(result, decode(b, e))
	}
	return result, nil
}

// Retire is transport-only; callers must first verify a durable committed inbox.
// A separate retention ACL role is required. It never ACKs pending messages.
func (c *Client) Retire(ctx context.Context, b telemetry.Binding, group string, d Delivery, minAge time.Duration) (string, error) {
	key, err := Key(b)
	if err != nil {
		return "", err
	}
	if !namePattern.MatchString(group) || !idPattern.MatchString(d.ID) || len(d.ID) > 128 || d.Err != nil || d.Key != d.Event.Identity() || d.ContentHash != d.Event.ContentHash() || d.Event.Validate(b) != nil || minAge < time.Minute || minAge > 7*24*time.Hour {
		return "", ErrInvalid
	}
	ctx, cancel := bounded(ctx)
	defer cancel()
	status, err := c.redis.Eval(ctx, retireScript, []string{key}, group, d.ID, d.Key, d.ContentHash, minAge.Milliseconds()).Text()
	if err != nil {
		return "", err
	}
	switch status {
	case "removed", "pending", "group_mismatch", "young", "changed", "missing":
		return status, nil
	default:
		return "", ErrProtocol
	}
}
