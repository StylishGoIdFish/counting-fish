# Base Image: Use Nginx on Alpine Linux (Tiny & Fast)
FROM nginx:alpine

# Clean Slate: Remove the default Nginx welcome page
RUN rm -rf /usr/share/nginx/html/*

# Deploy Website: Copy your static files to Nginx's public folder
COPY . /usr/share/nginx/html

# Expose the Web Port
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]