# Overleaf Community Edition, development environment

## Building and running

In this `develop` directory, build the services:

```shell
bin/build
```

> [!NOTE]
> If Docker is running out of RAM while building the services in parallel, create a `.env` file in this directory containing `COMPOSE_PARALLEL_LIMIT=1`.

Then start the services:

```shell
bin/up
```

Once the services are running, open <http://localhost/launchpad> to create the first admin account.

## Configuration

`dev.rc`, next to `dev.env`, holds the switches of the dev environment, like `overleaf.rc` in the Overleaf Toolkit. Change a value there and run `bin/dev` again to apply it. A feature that is turned off also stops its containers.

| Variable             | Default | What it does                                                                                                               |
| -------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `OVERLEAF_PORT`      | `80`    | Host port of the site                                                                                                      |
| `LDAP_ENABLED`       | `true`  | LDAP login with the [test users](authentication/README.md)                                                                 |
| `SAML_ENABLED`       | `true`  | SAML login with the [test users](authentication/README.md)                                                                 |
| `MAILPIT_ENABLED`    | `true`  | Catches every email from `web` in [Mailpit](https://github.com/axllent/mailpit)                                            |
| `S3_ENABLED`         | `true`  | Keeps history and template files in [RustFS](https://github.com/rustfs/rustfs)                                             |
| `HOPPSCOTCH_ENABLED` | `true`  | [Hoppscotch](https://github.com/hoppscotch/hoppscotch) with a proxy into the Docker network, see [Hoppscotch](#hoppscotch) |
| `HOPPSCOTCH_PORT`    | `9170`  | Host port of Hoppscotch                                                                                                    |
| `GRAFANA_ENABLED`    | `true`  | Grafana on `/grafana` of the site, with the state, metrics and logs of every service, see [Grafana](#grafana)              |

Each feature keeps its `docker-compose.yml` and other files in its own folder: `authentication/ldap`, `authentication/saml`, `mail`, `s3`, `hoppscotch` and `grafana`. A feature that needs a `web` setting without an environment variable mounts a file into `/etc/overleaf/settings.d/`, and `settings.dev-env.cjs` merges all of them.

The local volumes and RustFS are separate stores: a project created with `S3_ENABLED=true` has no history or binary files after switching to `false`, and the other way round.

### Moving existing data into RustFS

To keep the history and template files of an environment that ran before `S3_ENABLED` existed, copy them from the local volumes into RustFS once, while the services are running (`bin/up` or `bin/dev`):

```shell
docker run --rm --network develop_default \
  -v develop_history-v1-buckets:/buckets:ro \
  -v develop_filestore-template-files:/template_files:ro \
  -e AWS_ACCESS_KEY_ID=rustfsadmin -e AWS_SECRET_ACCESS_KEY=rustfsadmin \
  -e AWS_DEFAULT_REGION=us-east-1 -e AWS_ENDPOINT_URL=http://rustfs:9000 \
  --entrypoint sh amazon/aws-cli:2.39.1 -c '
    aws s3 sync /buckets/chunks s3://overleaf-chunks
    aws s3 sync /buckets/project_blobs s3://overleaf-project-blobs
    # filestore names a template file a_b_c on disk and a/b/c in S3
    mkdir -p /tmp/t && cd /template_files
    for f in *; do
      [ -e "$f" ] || continue
      key=$(echo "$f" | tr _ /)
      mkdir -p "/tmp/t/$(dirname "$key")"
      cp -p "$f" "/tmp/t/$key"
    done
    aws s3 sync /tmp/t s3://overleaf-template-files
  '
```

The volumes are mounted read-only, so the old files stay there for `S3_ENABLED=false`. Running the command again skips the files that RustFS already has.

## Ports

These pages listen on `127.0.0.1` of the host. The site uses `OVERLEAF_PORT` from `dev.rc`, so add the port to its address if you changed it. On a remote machine, forward the ports first, for example `ssh -L 8025:localhost:8025 <host>`.

| Page                   | Address                                 | Login                                                                       |
| ---------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| Site                   | <http://localhost>                      | The accounts of the site, or the [test users](authentication/README.md)     |
| Email inbox (Mailpit)  | <http://localhost:8025>                 | None                                                                        |
| S3 console (RustFS)    | <http://localhost:9001/rustfs/console/> | `rustfsadmin` / `rustfsadmin`                                               |
| Hoppscotch             | <http://localhost:9170>                 | None                                                                        |
| Grafana                | <http://localhost/grafana>              | None, anonymous users are admins                                            |

The S3 API (port 9000) and SMTP (port 1025) are only reachable inside the Docker network.

## Hoppscotch

Hoppscotch sends requests from the browser, which cannot reach the services by their Docker names. To call them, for example `http://docstore:3016/status`, open Settings → Interceptor in Hoppscotch once, pick Proxy and set its URL to the Hoppscotch address plus `/proxy`, such as `http://localhost:9170/proxy`. The setting stays in the browser.

`hoppscotch/openapi/` has an OpenAPI file for the internal API of each service. Import them in Collections → Import → Import from File, all files at once. Each file becomes a collection whose requests go to the service's Docker address.

## Grafana

Grafana is served by the site on `/grafana`, through webpack-dev-server, so it needs no port of its own. Its "Overleaf Develop" folder has:

| Dashboard                 | What it shows                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| All services (home)       | State of every service, host gauges, load and logs. A click on a service opens its dashboard      |
| Server                    | CPU, load, memory, disk and network of the host, and the compiles of clsi                         |
| Errors                    | Error logs, 5xx and 4xx responses, most frequent error messages and failing routes                 |
| Data flow                 | The path of an edit: document-updater and Redis, project-history, history-v1, Mongo, object store |
| Containers                | CPU, memory, network and disk of every container, sandboxed compiles included                     |
| One per service           | The Node.js services, git-bridge (JVM), mongo and redis                                            |

Prometheus scrapes `/metrics` of the services, `mongodb-exporter`, `redis-exporter`, `cadvisor` and `node-exporter`; Alloy sends the logs of every container of this project to Loki. Their data lives in the containers only, so recreating them empties it. cAdvisor runs privileged and reads the host's `/`, `/sys`, Docker data and the containerd socket, read-only; node-exporter reads the host's `/`.

The dashboards are generated: change `grafana/make-dashboards` and run it, instead of editing the JSON files.

## Development

To avoid running `bin/build && bin/up` after every code change, you can run Overleaf
Community Edition in _development mode_, where services will automatically update on code changes.

To do this, use the included `bin/dev` script:

```shell
bin/dev
```

This will start all services using `node --watch`, which will automatically monitor the code and restart the services as necessary.

To improve performance, you can start only a subset of the services in development mode by providing a space-separated list to the `bin/dev` script:

```shell
bin/dev [service1] [service2] ... [serviceN]
```

> [!NOTE]
> Starting the `web` service in _development mode_ will only update the `web`
> service when backend code changes. In order to automatically update frontend
> code as well, make sure to start the `webpack` service in _development mode_
> as well.

If no services are named, all services will start in development mode.

## Translations

After adding a translation or changing branch, run `bin/i18n`. It applies `services/web/locales/locales_patches` the way the image builds do and lists the keys the frontend uses. New translations go in `locales_patches/added`; the files it changes are local only, do not commit them. If the webpack image is missing, it syncs `yarn.lock` and builds the image first.

## Debugging

When run in _development mode_ most services expose a debugging port to which
you can attach a debugger such as
[the inspector in Chrome's Dev Tools](chrome://inspect/) or one integrated into
an IDE. The following table shows the port exposed on the **host machine** for
each service:

| Service            | Port |
| ------------------ | ---- |
| `web`              | 9229 |
| `clsi`             | 9230 |
| `chat`             | 9231 |
| `docstore`         | 9233 |
| `document-updater` | 9234 |
| `filestore`        | 9235 |
| `notifications`    | 9236 |
| `real-time`        | 9237 |
| `history-v1`       | 9239 |
| `project-history`  | 9240 |
| `linked-url-proxy` | 9241 |

To attach to a service using Chrome's _remote debugging_, go to
<chrome://inspect/> and make sure _Discover network targets_ is checked. Next
click _Configure..._ and add an entry `localhost:[service port]` for each of the
services you want to attach a debugger to.

After adding an entry, the service will show up as a _Remote Target_ that you
can inspect and debug.
