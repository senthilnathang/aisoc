#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p backend-go/.tools
GOBIN="$PWD/backend-go/.tools" GOTOOLCHAIN=go1.26.10 go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.11
GOBIN="$PWD/backend-go/.tools" GOTOOLCHAIN=go1.26.10 go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.6.1
PATH="$PWD/backend-go/.tools:$PATH" services/python-worker/.venv/bin/python -m grpc_tools.protoc \
  -I contracts/proto --go_out=backend-go --go_opt=module=aisoc/backend \
  --go-grpc_out=backend-go --go-grpc_opt=module=aisoc/backend \
  --python_out=services/python-worker --grpc_python_out=services/python-worker \
  contracts/proto/aisoc/worker/v1/worker.proto \
  contracts/proto/aisoc/worker/v1/investigation.proto
