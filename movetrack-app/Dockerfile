# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Accept build arguments for environment variables
ARG VITE_API_BASE_URL
ARG VITE_GOOGLE_MAPS_API_KEY

# Export as environment variables for Vite build
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY

# Build the application (temporary debug to confirm key value length)
RUN echo "VITE_GOOGLE_MAPS_API_KEY length during build: ${#VITE_GOOGLE_MAPS_API_KEY}" && \
    npm run build

# Production stage
FROM nginx:alpine

# Copy built files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Cloud Run requires port 8080
EXPOSE 8080

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
