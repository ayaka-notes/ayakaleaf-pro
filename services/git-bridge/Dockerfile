# Build the a8m/envsubst binary, as it supports default values,
# which the gnu envsubst (from gettext-base) does not.
FROM golang:1.25.5-alpine AS envsubst_builder

WORKDIR /build

RUN go install github.com/a8m/envsubst/cmd/envsubst@latest

FROM amazoncorretto@sha256:600e99e39da14b6a909027a924136c423e9334cb7347a8a77d5908bdaa3011b7 AS base

# Java4Shell (CVE-2026-114938) hardening: build on the patched Corretto 21
# build (21.0.13.1.2, 2026-11-17), pinned by digest so CI caches cannot fall
# back to an older build. The previous maven:3-amazoncorretto-21-debian base
# shipped the vulnerable 21.0.13.0.11. Maven is installed from the official
# Apache tarball so the ONLY JDK in the image is the patched Corretto above
# (no distro-JDK conflict on Alpine).
RUN apk add --no-cache make git sqlite curl bash \
 && curl -fsSL https://archive.apache.org/dist/maven/maven-3/3.9.11/binaries/apache-maven-3.9.11-bin.tar.gz -o /tmp/m.tgz \
 && tar -xzf /tmp/m.tgz -C /opt \
 && ln -s /opt/apache-maven-3.9.11/bin/mvn /usr/local/bin/mvn \
 && rm /tmp/m.tgz

COPY --from=envsubst_builder /go/bin/envsubst /opt/envsubst
RUN chmod +x /opt/envsubst

RUN adduser -D node && mkdir -p /home/node && chown node:node /home/node

ENV MAVEN_OPTS="-Dmaven.repo.local=/home/node/repository"

# Pre-resolve Maven dependencies and plugins into the base image to limit
# downstream `mvn` invocations hitting Maven Central on every CI build.
# Uses a stub source and test, since `dependency:go-offline` and `dependency:resolve-plugins`
# miss lazy-loaded plugins (surefire, maven-assembly, etc.)
COPY pom.xml /tmp/warmup/pom.xml
RUN mkdir -p /tmp/warmup/src/main/java/stub /tmp/warmup/src/test/java/stub \
 && echo 'package stub; public class Stub {}' > /tmp/warmup/src/main/java/stub/Stub.java \
 && echo 'package stub; public class StubTest { @org.junit.Test public void noop() {} }' \
      > /tmp/warmup/src/test/java/stub/StubTest.java \
&& mvn -B --no-transfer-progress -f /tmp/warmup/pom.xml clean package \
&& chown -R node:node /home/node/repository \
&& rm -rf /tmp/warmup

FROM base AS builder

COPY . /app

WORKDIR /app

RUN make package \
# The name of the created jar contains the current version tag.
# Rename it to a static path that can be used for copying.
&&  find /app/target \
      -name 'writelatex-git-bridge*jar-with-dependencies.jar' \
      -exec mv {} /git-bridge.jar \;

# Java4Shell (CVE-2026-114938): pin the runtime JVM to the same patched
# Corretto 21 build (21.0.13.1.2) rather than the floating :21-alpine tag.
FROM amazoncorretto@sha256:600e99e39da14b6a909027a924136c423e9334cb7347a8a77d5908bdaa3011b7

RUN apk add --update --no-cache bash git sqlite procps htop net-tools jemalloc util-linux

ENV LD_PRELOAD=/usr/lib/libjemalloc.so.2

RUN adduser -D node

COPY --from=builder /git-bridge.jar /

COPY --from=envsubst_builder /go/bin/envsubst /opt/envsubst
RUN chmod +x /opt/envsubst

COPY conf/envsubst_template.json envsubst_template.json
COPY start.sh start.sh
COPY server-pro-start.sh server-pro-start.sh

RUN mkdir conf
RUN chown node:node conf

USER node

CMD ["/start.sh"]
