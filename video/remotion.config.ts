import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// Brand type is loaded from Google Fonts inside the browser Remotion drives,
// so rendering must wait for the network rather than snapshotting fallbacks.
Config.setDelayRenderTimeoutInMilliseconds(60_000);
Config.setChromiumOpenGlRenderer("angle");
