test:
	go test ./...

lint:
	golangci-lint run ./...

fmt-changed:
	git diff --name-only | grep '\.tf$$' | xargs -r terraform fmt
