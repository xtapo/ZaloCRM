#!/usr/bin/env node
/**
 * Color guard — chặn màu hard-code lọt vào frontend/src.
 *
 * Bối cảnh: xuyên suốt đợt redesign soft-UI xanh lá (PR #13, #14, #15), lỗi lặp
 * đi lặp lại luôn là cùng một dạng — màu viết cứng nằm sâu trong component nên
 * không lộ ra khi đổi biến ở tầng theme, và build vẫn PASS. Ví dụ đã gặp:
 * sticky checkbox column của FriendsTable, ma trận phân quyền RBAC,
 * SecurityEventsView, modal StuckLeadsView.
 *
 * Nguyên tắc thiết kế: script CHỈ soi những dòng MỚI THÊM trong diff so với
 * nhánh base. Mã cũ không bị đụng tới, nên có thể bật ngay mà không phải dọn
 * sạch nợ kỹ thuật trước. Nợ cũ sẽ tự tiêu dần mỗi khi file được sửa lại.
 *
 * Chạy tay:  node scripts/check-hardcoded-colors.mjs
 * Đổi base:  COLOR_GUARD_BASE=origin/main node scripts/check-hardcoded-colors.mjs
 */

import { execSync } from "node:child_process"

const BASE = process.env.COLOR_GUARD_BASE || "origin/main"
const SCOPE = "frontend/src"
const ESCAPE_HATCH = "color-guard-allow"

/**
 * Màu thương hiệu bên thứ ba và token giới tính — bắt buộc giữ đúng mã màu,
 * không thay bằng token của design system.
 */
const ALLOWED_HEX = new Set(
	[
		"#0068ff", // Zalo
		"#0f9d58", // Google
		"#0088cc", // Telegram
		"#1877f2", // Facebook
		"#ff4a00", // Zapier
		"#ec4899", // --smax-female
		"#0ea5e9", // --smax-male
	].map((hex) => hex.toLowerCase()),
)

/**
 * Nơi hệ màu được ĐỊNH NGHĨA. Hex ở đây là hợp lệ theo thiết kế —
 * đó chính là nguồn của các biến mà phần còn lại của app phải dùng.
 */
const ALLOWED_FILES = new Set([
	"frontend/src/style.css",
	"frontend/src/assets/tokens.css",
	"frontend/src/assets/main.css",
	"frontend/src/constants/chart-theme.ts",
	"frontend/src/plugins/vuetify.ts",
])

const CHECKED_EXTENSIONS = [".vue", ".css", ".scss", ".ts"]

const HEX_PATTERN = /#[0-9a-fA-F]{3,8}\b/g
const NAMED_COLOR_PATTERN =
	/\b(?:background|background-color|color|border|border-color|border-top|border-bottom|border-left|border-right|fill|stroke|box-shadow|outline)\s*:[^;]*\b(white|black)\b/i

function shouldCheckFile(path) {
	if (!path.startsWith(`${SCOPE}/`)) return false
	if (ALLOWED_FILES.has(path)) return false
	return CHECKED_EXTENSIONS.some((ext) => path.endsWith(ext))
}

/**
 * Bỏ qua hex nằm trong URL, data URI và nội dung SVG nhúng — đó là dữ liệu ảnh,
 * không phải quyết định về màu giao diện.
 */
function stripNonStyleContexts(line) {
	return line
		.replace(/url\([^)]*\)/gi, "")
		.replace(/data:[^"')\s]+/gi, "")
		.replace(/%23[0-9a-fA-F]{3,8}/g, "")
}

function getAddedLines() {
	let diff
	try {
		diff = execSync(
			`git diff -U0 ${BASE}...HEAD -- ${SCOPE}`,
			{ encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
		)
	} catch (error) {
		console.error(
			`Không đọc được diff so với "${BASE}". Đảm bảo đã fetch đủ lịch sử ` +
				`(actions/checkout cần fetch-depth: 0).`,
		)
		console.error(error.message)
		process.exit(2)
	}

	const added = []
	let currentFile = null
	let lineNumber = 0

	for (const rawLine of diff.split("\n")) {
		if (rawLine.startsWith("+++ ")) {
			const path = rawLine.slice(4).trim()
			currentFile = path === "/dev/null" ? null : path.replace(/^b\//, "")
			continue
		}

		const hunkMatch = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
		if (hunkMatch) {
			lineNumber = Number(hunkMatch[1])
			continue
		}

		if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
			if (currentFile) {
				added.push({
					file: currentFile,
					line: lineNumber,
					text: rawLine.slice(1),
				})
			}
			lineNumber += 1
		}
	}

	return added
}

function findViolations(addedLines) {
	const violations = []

	for (const { file, line, text } of addedLines) {
		if (!shouldCheckFile(file)) continue
		if (text.includes(ESCAPE_HATCH)) continue

		const cleaned = stripNonStyleContexts(text)

		for (const match of cleaned.match(HEX_PATTERN) || []) {
			if (ALLOWED_HEX.has(match.toLowerCase())) continue
			violations.push({
				file,
				line,
				found: match,
				snippet: text.trim(),
			})
		}

		const namedMatch = cleaned.match(NAMED_COLOR_PATTERN)
		if (namedMatch) {
			violations.push({
				file,
				line,
				found: namedMatch[1],
				snippet: text.trim(),
			})
		}
	}

	return violations
}

function report(violations) {
	console.error(
		`\n✖ Color guard: phát hiện ${violations.length} màu hard-code trong các dòng mới.\n`,
	)

	const byFile = new Map()
	for (const violation of violations) {
		if (!byFile.has(violation.file)) byFile.set(violation.file, [])
		byFile.get(violation.file).push(violation)
	}

	for (const [file, items] of byFile) {
		console.error(`  ${file}`)
		for (const item of items) {
			console.error(`    ${item.line}: ${item.found}  →  ${item.snippet}`)
		}
		console.error("")
	}

	console.error("Cách xử lý:")
	console.error(
		"  1. Thay bằng token trong frontend/src/style.css — ví dụ var(--smax-surface),",
	)
	console.error(
		"     var(--smax-text), var(--smax-text-muted), var(--smax-surface-border),",
	)
	console.error("     var(--smax-primary), var(--shadow-sm), var(--radius-lg).")
	console.error(
		"  2. Màu biểu đồ lấy từ frontend/src/constants/chart-theme.ts (BRAND, CHART_SERIES).",
	)
	console.error(
		"  3. Nếu thật sự cần màu cố định (logo bên thứ ba, minh hoạ), thêm comment",
	)
	console.error(`     /* ${ESCAPE_HATCH} */ trên cùng dòng kèm lý do.\n`)
	console.error(
		"Lý do có luật này: màu hard-code vẫn build PASS nhưng vỡ ở theme legacy-dark —",
	)
	console.error(
		"đúng loại lỗi đã phải đi dọn thủ công ở PR #15.\n",
	)
}

const addedLines = getAddedLines()
const violations = findViolations(addedLines)

if (violations.length > 0) {
	report(violations)
	process.exit(1)
}

console.log(
	`✓ Color guard: không có màu hard-code trong ${addedLines.length} dòng mới thuộc ${SCOPE}.`,
)
