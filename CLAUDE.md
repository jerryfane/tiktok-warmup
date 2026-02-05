# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TikTok automation system that uses AI agents with staged architecture to interact with TikTok on multiple Android devices. The system uses Vision API for UI analysis and LLM for comment generation.

## Commands

### Development
- `pnpm dev` - Start with debug logging enabled
- `pnpm start` - Run the bot on all connected devices
- `pnpm start --device <device_id>` - Run on specific device
- `pnpm start --max-devices <num>` - Limit number of devices
- `DEBUG=agent:* pnpm start` - Enable detailed debug logging

### Build & Test
- `pnpm build` - Build TypeScript to dist/
- `pnpm test` - Run Vitest tests
- `pnpm test:watch` - Run tests in watch mode
- `pnpm test:coverage` - Run tests with coverage report

### Code Quality
- `pnpm lint` - Run ESLint
- `pnpm lint:fix` - Fix ESLint issues automatically
- `pnpm format` - Format code with Prettier
- `pnpm typecheck` - Run TypeScript type checking

### Utilities
- `pnpm clean` - Clean dist, coverage, and cache directories
- `adb devices` - List connected Android devices (external dependency)

## Architecture

The system follows a three-stage architecture with multiple components working together:

### Core Components
- **DeviceManager** (`src/core/DeviceManager.ts`) - Scans ADB devices and manages connections
- **Worker** (`src/core/Worker.ts`) - Individual agent instance per Android device
- **AgentManager** (`src/core/AgentManager.ts`) - Orchestrates stage transitions and memory management
- **UIDataPersistence** (`src/core/UIDataPersistence.ts`) - Persists learned UI coordinates

### Three-Stage Flow
1. **Initiating** - Launch TikTok and wait for app readiness
2. **Learning** (`src/stages/learning.ts`) - AI-powered UI analysis to detect button coordinates (like, comment, input fields)
3. **Working** (`src/stages/working.ts`) - Main automation loop (watch, like, comment, swipe)

### Supporting Tools
- **interaction.ts** - AI-powered screen interaction wrapper using Gemini Vision API
- **llm.ts** - LLM integration for comment generation
- **utils.ts** - Logging, delays, and utility functions

### Configuration
- **presets.ts** - Automation behavior settings (watch duration, interaction chances, daily limits)

## Key Technologies

- **TypeScript** - Primary language with strict typing
- **Google Gemini API** - Vision API for UI analysis and LLM for comments
- **ADB (Android Debug Bridge)** - Device control and interaction
- **Vitest** - Testing framework
- **ESLint + Prettier** - Code quality and formatting
- **pnpm** - Package manager

## Environment Setup

1. Copy `.env.example` to `.env`
2. Add Google Gemini API key: `GOOGLE_GENERATIVE_AI_API_KEY=your_key_here`
3. Ensure Android devices have USB debugging enabled
4. Verify ADB access with `adb devices`

## Development Notes

- The system is designed for Android devices only
- Uses direct ADB commands for device interaction
- AI vision analysis determines UI element coordinates dynamically
- Stage transitions are managed by AgentManager with memory persistence
- Multi-device support runs agents concurrently
- Includes health monitoring and shadow ban detection
- Daily action limits and realistic timing patterns for safety

## File Structure Highlights

```
src/
├── core/           # Main system components
├── stages/         # Three automation stages
├── tools/          # AI interaction and utilities
├── config/         # Automation presets and settings
└── index.ts        # Main entry point and CLI
```

The codebase emphasizes modularity with clear separation between device management, AI-powered UI analysis, and automation execution stages.