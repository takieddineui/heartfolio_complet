import type { ThemeEngineConfig } from "@/types/studio";
import { DEFAULT_GIFT, GIFT_IDS } from "./gifts";

/**
 * One axis: which gift. Switching it in the Studio is how the sender sees all
 * four before choosing; the recipient only ever gets the one chosen (the
 * prototype's on-page gift switcher was preview scaffolding and is gone).
 * The gifts carry their own colours and fonts, so no tokens are merged here.
 */
export const reasonsThemes: ThemeEngineConfig = {
  axes: [
    {
      id: "gift",
      label: "themes.gift.label",
      kind: "select",
      defaultOptionId: DEFAULT_GIFT,
      options: GIFT_IDS.map((id) => ({ id, label: `gifts.${id}.name` })),
    },
  ],
};
