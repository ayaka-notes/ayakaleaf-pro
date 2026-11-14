FROM nginx:1.27.3
RUN apt-get update \
	&& apt-get install -y openssl \
	&& openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
		-keyout /etc/ssl/private/nginx-selfsigned.key \
		-out /etc/ssl/certs/nginx-selfsigned.crt \
		-subj "/CN=localhost" \
	&& apt-get clean
COPY nginx.conf /etc/nginx/nginx.conf
