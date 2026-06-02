# babble-drachtio-callmanager test image
#
# callmanager talks to projectrtp as a client, but its interface tests boot a
# real local engine (projectrtp.run()). @babblevoice/projectrtp 3.x is a Rust
# napi addon shipped as source (rust/ + libilbc/) with no install hook, so we
# compile it in a rust-builder stage and drop the resulting .so into
# node_modules/@babblevoice/projectrtp/build/Release/ — then run the suite
# against the real engine (no mocking). Mirrors babble-rtp's Dockerfile.
#
#   docker build --target test -t callmanager:test .
#   docker run --rm callmanager:test
#   docker run --rm callmanager:test npx mocha --recursive --check-leaks --grep '486'

# --- Stage 1: install node deps (incl. dev deps for the test run) -----------
FROM alpine:3.22 AS deps
WORKDIR /usr/src/callmanager/
RUN apk add --no-cache nodejs npm
COPY package.json package-lock.json ./
# --ignore-scripts: projectrtp 3.x has no install hook; we build the Rust
# addon ourselves in the next stage.
RUN npm ci --ignore-scripts

# --- Stage 2: build the Rust napi cdylib + libilbc --------------------------
# Pinned to rust 1.92 to match projectrtp's own build.
FROM rust:1.92-alpine3.22 AS rust-builder
WORKDIR /src
RUN apk add --no-cache musl-dev pkgconfig cmake build-base linux-headers spandsp3-dev
COPY --from=deps /usr/src/callmanager/node_modules/@babblevoice/projectrtp/libilbc/ /src/libilbc/
RUN mkdir -p /src/libilbc/_build && \
    cd /src/libilbc/_build && \
    cmake -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr/local .. && \
    make -j"$(nproc)" && make install && \
    ldconfig /usr/local/lib 2>/dev/null || true
COPY --from=deps /usr/src/callmanager/node_modules/@babblevoice/projectrtp/rust/ /src/rust/
WORKDIR /src/rust
# Alpine's rust defaults to musl with +crt-static; a cdylib loaded by Node at
# runtime needs dynamic linkage, so override.
ENV RUSTFLAGS="-C target-feature=-crt-static"
RUN cargo build --release

# --- Stage 3: test image ----------------------------------------------------
FROM alpine:3.22 AS test
WORKDIR /usr/src/callmanager/
RUN apk add --no-cache nodejs npm spandsp3 libstdc++ libc6-compat ca-certificates
COPY --from=deps /usr/src/callmanager/node_modules ./node_modules
COPY --from=rust-builder /usr/local/lib/libilbc.so* /usr/lib/
COPY --from=rust-builder /src/rust/target/release/libprojectrtp.so \
     ./node_modules/@babblevoice/projectrtp/build/Release/projectrtp.node
COPY package.json package-lock.json index.js ./
COPY lib/ ./lib/
COPY test/ ./test/
CMD [ "npm", "test" ]
