// Encryption utilities for Linear tokens

export async function encrypt(
	plaintext: string,
	encryptionKey: string,
): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(plaintext);

	// Derive encryption key from COOKIE_ENCRYPTION_KEY
	const keyMaterial = encoder.encode(encryptionKey);
	const keyHash = await crypto.subtle.digest("SHA-256", keyMaterial);
	const key = await crypto.subtle.importKey(
		"raw",
		keyHash,
		{ name: "AES-GCM" },
		false,
		["encrypt"],
	);

	// Generate random IV
	const iv = crypto.getRandomValues(new Uint8Array(12));

	// Encrypt
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		data,
	);

	// Combine IV + ciphertext and encode as base64
	const combined = new Uint8Array(iv.length + ciphertext.byteLength);
	combined.set(iv);
	combined.set(new Uint8Array(ciphertext), iv.length);

	return btoa(String.fromCharCode(...combined));
}

export async function decrypt(
	encrypted: string,
	encryptionKey: string,
): Promise<string> {
	const encoder = new TextEncoder();

	// Derive decryption key from COOKIE_ENCRYPTION_KEY
	const keyMaterial = encoder.encode(encryptionKey);
	const keyHash = await crypto.subtle.digest("SHA-256", keyMaterial);
	const key = await crypto.subtle.importKey(
		"raw",
		keyHash,
		{ name: "AES-GCM" },
		false,
		["decrypt"],
	);

	// Decode base64
	const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));

	// Extract IV and ciphertext
	const iv = combined.slice(0, 12);
	const ciphertext = combined.slice(12);

	// Decrypt
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		key,
		ciphertext,
	);

	const decoder = new TextDecoder();
	return decoder.decode(plaintext);
}
