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

FROM mcr.microsoft.com/dotnet/aspnet:10.0.14-noble-chiseled-extra AS runtime
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Ticketing.Api.dll"]
