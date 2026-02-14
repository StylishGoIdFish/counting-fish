# 1. Base Image: Use Nginx on Alpine Linux (Tiny & Fast)
FROM nginx:alpine

# 2. Clean Slate: Remove the default Nginx welcome page
RUN rm -rf /usr/share/nginx/html/*

# 3. Deploy Website: Copy your static files to Nginx's public folder
COPY . /usr/share/nginx/html

# 4. Configuration (Optional but Recommended)
# If you had a custom nginx.conf, you would copy it here. 
# For this hackathon, the default config works fine.

# 5. Expose the Web Port
EXPOSE 80

# 6. Start Nginx
CMD ["nginx", "-g", "daemon off;"]