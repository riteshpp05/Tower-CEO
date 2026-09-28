@echo off
echo ====================================================
echo  Docker Build and Push Script
echo ====================================================
echo.
echo IMPORTANT: You MUST be logged in to Docker Hub before running this.
echo If you haven't logged in, press Ctrl+C, type 'docker login', and try again.
pause

echo.
echo Building all Docker images (this may take a few minutes)...
docker-compose build

echo.
echo Pushing images to Docker Hub...
docker-compose push

echo.
echo ====================================================
echo  Done! All images pushed successfully.
echo ====================================================
pause
