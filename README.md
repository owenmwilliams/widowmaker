# MoveTrack

**Smart Moving & Storage Inventory Management**

MoveTrack is a comprehensive inventory management system designed specifically for moving, relocation, and storage use cases. Built on Vue 3 and Node.js, it helps individuals and families organize, track, and manage their belongings during moves and while in storage.

## Project Structure

The MoveTrack project is organized into the following main components:

-   **/movetrack-api**: The backend API server, built with Node.js and Express. It handles all business logic, database interactions, and communication with external services.
-   **/movetrack-app**: The frontend application, built with Vue.js and Quasar. It provides the user interface for managing inventory, moves, and storage.
-   **/scripts**: A collection of helper scripts for development and deployment. This includes scripts for setting up the project, running tests, and deploying to cloud services.
-   **/archived**: Contains standalone or deprecated components that are not part of the main application.
    -   **/vision-pipeline**: A separate mono-repo for an advanced image recognition system.

## Getting Started

### Prerequisites

-   Docker and Docker Compose
-   Node.js 16+
-   Git

### Installation

1.  **Clone the repository**
    ```bash
    git clone <your-repo-url> movetrack
    cd movetrack
    ```

2.  **Run the setup script**
    The setup script will create a `.env` file from the example and start the application using Docker Compose.
    ```bash
    ./scripts/setup.sh
    ```

3.  **Access the application**
    -   Frontend: http://localhost:4050
    -   API: http://localhost:3050
    -   pgAdmin: http://localhost:5050

## Key Features

-   **Multi-level Organization**: Locations → Collections (Rooms) → Containers (Boxes) → Items
-   **Photo Documentation**: Capture images of items and boxes using a mobile camera.
-   **AI-Powered Descriptions**: Automatically generate item descriptions using AI.
-   **QR Code Labels**: Generate and print QR codes for boxes (coming soon).
-   **Search & Filter**: Quickly find items across all locations.
-   **Move Projects**: Track entire relocation operations from planning to completion.
-   **Storage Unit Tracking**: Monitor multiple storage units with costs and access details.

## Technology Stack

**Frontend (movetrack-app)**
-   Vue 3 + TypeScript
-   Quasar Framework
-   Pinia for state management
-   Capacitor for mobile apps

**Backend (movetrack-api)**
-   Node.js + Express
-   PostgreSQL 14 database
-   Knex.js for migrations

**Infrastructure**
-   Docker Compose for local development
-   Google Cloud Platform for deployment
