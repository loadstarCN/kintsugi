package com.kintsugi.sdk;

/**
 * Thrown when the platform returns a non-2xx response.
 * <p>
 * code / message come from the server's {code, message, detail} envelope when
 * Content-Type is JSON; for non-JSON responses the body text is used as message.
 */
public class KintsugiHttpException extends RuntimeException {
    private final int status;
    private final String code;
    private final Object body;

    public KintsugiHttpException(int status, String code, String message, Object body) {
        super(formatMsg(status, code, message));
        this.status = status;
        this.code = code;
        this.body = body;
    }

    private static String formatMsg(int status, String code, String message) {
        if (code != null && !code.isEmpty()) {
            return "kintsugi: HTTP " + status + " " + code + ": " + (message == null ? "" : message);
        }
        return "kintsugi: HTTP " + status + ": " + (message == null ? "" : message);
    }

    public int status() { return status; }
    public String code() { return code; }
    public Object body() { return body; }
}
