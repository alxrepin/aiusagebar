import type { LanguagePref } from "../shared/types";

/** Language for texts produced by the Bun process (system notifications). */
let pref: LanguagePref = "system";

export function setLanguage(p: LanguagePref) {
	pref = p;
}

function systemIsRu(): boolean {
	try {
		return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("ru");
	} catch {
		return false;
	}
}

export function isRu(): boolean {
	return pref === "system" ? systemIsRu() : pref === "ru";
}
