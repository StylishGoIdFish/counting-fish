# Use Nginx on Alpine Linux as base image
FROM nginx:alpine

RUN rm -rf /usr/share/nginx/html/*

# copy static files to Nginx's public folder
COPY . /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]