using System.Text.Json;
using System.Text.Json.Serialization;

namespace Ticketing.Application.Common;

/// <summary>
/// A PATCH field: omitted (<see cref="HasValue"/> false) leaves the stored value unchanged; present (including null)
/// replaces it. Declare PATCH commands as records with init-only <c>Optional&lt;T&gt;</c> properties (see <c>UpdateProject</c>).
/// </summary>
[JsonConverter(typeof(OptionalJsonConverterFactory))]
public readonly record struct Optional<T>
{
    private readonly T _value;

    public Optional(T value)
    {
        _value = value;
        HasValue = true;
    }

    public bool HasValue { get; }

    public T Value => HasValue ? _value : throw new InvalidOperationException("The optional value was not supplied.");

    public static implicit operator Optional<T>(T value) => new(value);

    public T GetValueOrDefault(T fallback) => HasValue ? _value : fallback;
}

public sealed class OptionalJsonConverterFactory : JsonConverterFactory
{
    public override bool CanConvert(Type typeToConvert) =>
        typeToConvert.IsGenericType && typeToConvert.GetGenericTypeDefinition() == typeof(Optional<>);

    public override JsonConverter CreateConverter(Type typeToConvert, JsonSerializerOptions options) =>
        (JsonConverter)Activator.CreateInstance(typeof(OptionalJsonConverter<>).MakeGenericType(typeToConvert.GetGenericArguments()[0]))!;

    private sealed class OptionalJsonConverter<T> : JsonConverter<Optional<T>>
    {
        public override bool HandleNull => true;

        public override Optional<T> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
            new(JsonSerializer.Deserialize<T>(ref reader, options)!);

        public override void Write(Utf8JsonWriter writer, Optional<T> value, JsonSerializerOptions options)
        {
            if (value.HasValue)
                JsonSerializer.Serialize(writer, value.Value, options);
            else
                writer.WriteNullValue();
        }
    }
}
