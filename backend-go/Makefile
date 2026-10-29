.PHONY: build test fmt vet migrate api worker probe
build:
	go build -o bin/api ./cmd/api
	go build -o bin/migrate ./cmd/migrate
	go build -o bin/data-migrate ./cmd/data-migrate
	go build -o bin/investigation-worker ./cmd/investigation-worker
	go build -o bin/worker ./cmd/worker
	go build -o bin/plugin-probe ./cmd/plugin-probe
test:
	go test -race -p 1 ./...
fmt:
	gofmt -w cmd internal migrations
vet:
	go vet ./...
migrate:
	go run ./cmd/migrate
api:
	go run ./cmd/api
worker:
	go run ./cmd/worker
probe:
	go run ./cmd/plugin-probe
