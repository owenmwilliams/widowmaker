#!/bin/bash

echo "🚀 MoveTrack Setup Script"
echo "=========================="
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created. Please edit it with your configuration."
    echo ""
else
    echo "✅ .env file already exists"
    echo ""
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

echo "✅ Docker is running"
echo ""

# Ask user if they want to start with Docker
read -p "Do you want to start MoveTrack with Docker? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]
then
    echo "🐳 Starting MoveTrack with Docker Compose..."
    docker-compose up -d
    echo ""
    echo "✨ MoveTrack is starting up!"
    echo ""
    echo "📍 Access points:"
    echo "   - Frontend:  http://localhost:4050"
    echo "   - API:       http://localhost:3050"
    echo "   - pgAdmin:   http://localhost:5050"
    echo ""
    echo "⏳ Please wait 30-60 seconds for all services to be ready."
    echo ""
    echo "To view logs: docker-compose logs -f"
    echo "To stop:      docker-compose down"
    echo ""
else
    echo "Skipping Docker startup. You can start manually with:"
    echo "  docker-compose up -d"
    echo ""
fi

# Check if node_modules exist
echo "Checking dependencies..."
if [ ! -d "movetrack-app/node_modules" ]; then
    echo "⚠️  Frontend dependencies not installed"
    echo "   Run: cd movetrack-app && npm install"
fi

if [ ! -d "movetrack-api/node_modules" ]; then
    echo "⚠️  API dependencies not installed"
    echo "   Run: cd movetrack-api && npm install"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📖 Next steps:"
echo "   1. Edit .env file with your configuration (optional)"
echo "   2. Access the app at http://localhost:4050"
echo "   3. Read the README.md for detailed documentation"
echo ""
echo "Happy organizing! 📦✨"
