import "server-only";

/** Temporary production QA bypass. It applies only to the one test number and is off by default. */
export function otpTestBypassEnabled(phone: string) {
  if (process.env.NODE_ENV !== "production" || !/^(1|true)$/i.test(process.env.OTP_TEST_BYPASS ?? "")) return false;
  const tenDigits = (value: string | undefined) => {
    const digits = value?.replace(/\D/g, "") ?? "";
    return digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  };
  const allowlisted = tenDigits(process.env.OTP_TEST_PHONE);
  return /^\d{10}$/.test(allowlisted) && tenDigits(phone) === allowlisted;
}

/** Never send the shared test code to a phone that is not on the QA allowlist. */
export const OTP_TEST_CODE = "0000";
