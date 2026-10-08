import type { FormSchemaConfig } from "@/types/studio";
import { mapMetadata } from "./metadata";

export const mapSchema: FormSchemaConfig = {
  sections: [
    {
      id: "story",
      title: "sections.story",
      fields: [
        { id: "partner1", type: "text", label: "fields.partner1.label", required: true, maxLength: 20 },
        { id: "partner2", type: "text", label: "fields.partner2.label", required: true, maxLength: 20 },
        { id: "date", type: "date", label: "fields.date.label", required: true },
        { id: "message", type: "textarea", label: "fields.message.label", maxLength: mapMetadata.messageMaxLength },
      ],
    },
    {
      id: "location",
      title: "sections.location",
      fields: [
        { id: "locationLabel", type: "text", label: "fields.locationLabel.label", required: true, maxLength: 40, placeholder: "fields.locationLabel.placeholder" },
        { id: "coordinates", type: "coordinates", label: "fields.coordinates.label", helpText: "fields.coordinates.help", required: true },
        { id: "photo", type: "image", label: "fields.photo.label" },
      ],
    },
  ],
};
