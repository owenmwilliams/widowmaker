# Use Node.js LTS version
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (production only for smaller image)
RUN npm ci --only=production

# Copy application code
COPY . .

# Cloud Run requires port 8080
EXPOSE 8080

# Set PORT environment variable for Cloud Run
ENV PORT=8080

# Start the application
CMD ["npm", "start"]