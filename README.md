# Jellyfeatured

A simple Jellyfin plugin with no functionality. This plugin can be installed but does nothing - it serves as a minimal example.

## Building

```bash
dotnet build
```

## Installation

1. Build the plugin
2. Copy the built DLL to your Jellyfin plugins directory
3. Restart Jellyfin

## Plugin Structure

- `Plugin.cs` - Main plugin class
- `PluginConfiguration.cs` - Configuration class (empty for this simple plugin)
- `manifest.json` - Plugin metadata
- `Jellyfeatured.csproj` - Project file