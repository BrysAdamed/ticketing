# Build context: repository root (docker compose sets it).
FROM mcr.microsoft.com/dotnet/sdk:10.0.403-noble AS build
WORKDIR /src
COPY global.json Directory.Build.props Directory.Packages.props .editorconfig ./
COPY src/Ticketing.Domain/Ticketing.Domain.csproj src/Ticketing.Domain/
COPY src/Ticketing.Application/Ticketing.Application.csproj src/Ticketing.Application/
COPY src/Ticketing.Infrastructure/Ticketing.Infrastructure.csproj src/Ticketing.Infrastructure/
COPY src/Ticketing.Api/Ticketing.Api.csproj src/Ticketing.Api/
RUN dotnet restore src/Ticketing.Api/Ticketing.Api.csproj
COPY src/ src/
RUN dotnet publish src/Ticketing.Api/Ticketing.Api.csproj -c Release -o /app --no-restore

# The PDF print bundle (D-100): the SPA's markdown and Mermaid renderers as one framework-free script, posted to the renderer.
FROM node:24.22.1-alpine AS print
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build:print -- /print

FROM mcr.microsoft.com/dotnet/aspnet:10.0.14-noble-chiseled-extra AS runtime
WORKDIR /app
COPY --from=build /app .
COPY --from=print /print ./print
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Ticketing.Api.dll"]
