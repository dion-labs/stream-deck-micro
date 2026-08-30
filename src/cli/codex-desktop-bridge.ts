#!/usr/bin/env node
import { runDesktopBridge } from '../desktopBridge.js';

process.exitCode = await runDesktopBridge({ args: process.argv.slice(2) });
