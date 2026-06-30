import { AppError } from "./errors";
import type { PublicSubmitEventInput } from "./schemas";

const SECRET_FIELDS: Array<keyof PublicSubmitEventInput> = [
  "unlockCode",
  "secretInfo",
  "secretLocationName",
  "secretLatitude",
  "secretLongitude",
  "secretMapNote",
];

export function assertPublicSubmitAllowed(input: PublicSubmitEventInput): void {
  if (input.website) {
    throw new AppError("Neplatné tělo požadavku", {
      code: "VALIDATION_ERROR",
      status: 400,
      expose: true,
    });
  }

  if ((input.accessType ?? "public") !== "public") {
    throw new AppError("Veřejný formulář přijímá jen veřejné akce", {
      code: "PUBLIC_SUBMIT_PUBLIC_ONLY",
      status: 400,
      expose: true,
    });
  }

  for (const field of SECRET_FIELDS) {
    const value = input[field];
    const hasSecretValue = typeof value === "string" ? value.trim().length > 0 : value !== undefined;
    if (hasSecretValue) {
      throw new AppError("Tajné údaje patří do Studio/Admin publikování", {
        code: "PUBLIC_SUBMIT_SECRET_FIELDS",
        status: 400,
        expose: true,
      });
    }
  }
}
