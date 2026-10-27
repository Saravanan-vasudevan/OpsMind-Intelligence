# Build context is the repository root (see docker-compose.yml) because the API embeds database/migrations/*.sql.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY backend/src/OpsMind.Api/OpsMind.Api.csproj backend/src/OpsMind.Api/
RUN dotnet restore backend/src/OpsMind.Api/OpsMind.Api.csproj
COPY backend/src/ backend/src/
COPY database/migrations/ database/migrations/
RUN dotnet publish backend/src/OpsMind.Api/OpsMind.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "OpsMind.Api.dll"]
