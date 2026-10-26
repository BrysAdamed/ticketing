using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;
using Ticketing.Application.Common;

namespace Ticketing.Api.Http;

/// <summary>Wire format shared by REST and MCP: enums as PascalCase names, timestamps as ISO 8601 UTC with a <c>Z</c> suffix.</summary>
public static class JsonSetup
{
    public static void Apply(JsonSerializerOptions options)
    {
        options.Converters.Add(new JsonStringEnumConverter(allowIntegerValues: false));
        options.Converters.Add(new UtcDateTimeOffsetConverter());
    }

    /// <summary>
    /// Names schemas of nested use-case types after their use case (<c>CreateProjectCommand</c>, not <c>Command</c>) and
    /// documents <see cref="Optional{T}"/> PATCH fields inline as their inner type.
    /// </summary>
    public static OpenApiOptions ConfigureTicketingSchemas(this OpenApiOptions options)
    {
        options.CreateSchemaReferenceId = typeInfo =>
        {
            var type = typeInfo.Type;
            if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(Optional<>))
                return null;
            var id = OpenApiOptions.CreateDefaultSchemaReferenceId(typeInfo);
            return id is not null && type.IsNested && type.DeclaringType is { } declaring ? declaring.Name + id : id;
        };
        return options.AddSchemaTransformer(async (schema, context, cancellationToken) =>
        {
            var type = context.JsonTypeInfo.Type;
            if (!type.IsGenericType || type.GetGenericTypeDefinition() != typeof(Optional<>))
                return;
            var inner = await context.GetOrCreateSchemaAsync(type.GetGenericArguments()[0], null, cancellationToken);
            schema.Type = inner.Type;
            schema.Format = inner.Format;
            schema.Enum = inner.Enum;
            schema.Items = inner.Items;
            schema.MaxLength = inner.MaxLength;
            schema.Pattern = inner.Pattern;
            schema.Properties = inner.Properties;
            schema.Description = "Optional PATCH field: omit to keep the current value; null clears an optional field.";
        });
    }

    private sealed class UtcDateTimeOffsetConverter : JsonConverter<DateTimeOffset>
    {
        private const string Format = "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'";

        public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
            DateTimeOffset.Parse(reader.GetString()!, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);

        public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options) =>
            writer.WriteStringValue(value.UtcDateTime.ToString(Format, CultureInfo.InvariantCulture));
    }
}
