import type { ExportEngineConfig } from "@/types/studio";

export const mapExports: ExportEngineConfig = {
  targets: {
    default: [
      { id: "story-png", label: "exports.story", mimeType: "image/png", width: 1080, height: 1920 },
      { id: "square-png", label: "exports.square", mimeType: "image/png", width: 1080, height: 1080 },
      { id: "portrait-png", label: "exports.portrait", mimeType: "image/png", width: 1080, height: 1350 },
      { id: "print-png", label: "exports.print", mimeType: "image/png", width: 2480, height: 3508 },
    ],
  },
};
