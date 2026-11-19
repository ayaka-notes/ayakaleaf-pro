// src/extensions/codemirror/languages/safeTypstPatch.ts
//
// TeXlyre integration for codemirror-lang-typst@0.6.x.
// TeXlyre uses the native Typst Lezer parser while keeping syntax highlighting
// under the application's CodeMirror theme instead of the package's bundled
// highlight styles.
//
// Annotation tags are hidden from language parsing through disjoint parse
// ranges. The Typst parser parses those ranges as compacted text, so syntax-tree
// offsets no longer correspond to their original document positions. This
// wrapper restores those positions after parsing, keeping comments and reviews
// transparent to highlighting, linting, completion, indentation, and folding.

import { LanguageSupport } from '@codemirror/language';
import {
	Tree,
	type Input,
	type PartialParse,
	type SyntaxNode,
	type TreeFragment,
} from '@lezer/common';
import {
	typst_lezer,
	typstLezerFoldService,
	typstLezerIndentService,
	typstLezerLinter,
	typstLezerListKeymap,
} from 'codemirror-lang-typst/lezer';

interface ParseRange {
	from: number;
	to: number;
}

interface RangedParser {
	createParse(
		input: Input,
		fragments: readonly TreeFragment[],
		ranges: readonly ParseRange[],
	): PartialParse;
}

const patchedParsers = new WeakSet<object>();

function hasGaps(ranges: readonly ParseRange[]): boolean {
	for (let i = 1; i < ranges.length; i++) {
		if (ranges[i - 1].to < ranges[i].from) return true;
	}
	return false;
}

function documentPosition(
	position: number,
	ranges: readonly ParseRange[],
	assoc: -1 | 1,
): number {
	if (!ranges.length) return position;

	let virtualStart = 0;

	for (let i = 0; i < ranges.length; i++) {
		const range = ranges[i];
		const length = range.to - range.from;
		const virtualEnd = virtualStart + length;

		if (position < virtualEnd) {
			return range.from + position - virtualStart;
		}

		if (position === virtualEnd) {
			if (assoc < 0 || i === ranges.length - 1) {
				return range.to;
			}
			return ranges[i + 1].from;
		}

		virtualStart = virtualEnd;
	}

	return ranges[ranges.length - 1].to;
}

function nodePositions(
	node: SyntaxNode,
	ranges: readonly ParseRange[],
): { from: number; to: number } {
	if (node.from === node.to) {
		const position = documentPosition(node.from, ranges, 1);
		return { from: position, to: position };
	}

	return {
		from: documentPosition(node.from, ranges, 1),
		to: documentPosition(node.to, ranges, -1),
	};
}

function restoreNodePositions(
	node: SyntaxNode,
	ranges: readonly ParseRange[],
): Tree {
	const { from, to } = nodePositions(node, ranges);
	const children: Tree[] = [];
	const positions: number[] = [];

	for (let child = node.firstChild; child; child = child.nextSibling) {
		const childPosition = nodePositions(child, ranges);

		children.push(restoreNodePositions(child, ranges));
		positions.push(childPosition.from - from);
	}

	return new Tree(node.type, children, positions, Math.max(0, to - from));
}

function restoreDocumentPositions(
	tree: Tree,
	ranges: readonly ParseRange[],
): Tree {
	return restoreNodePositions(tree.topNode, ranges);
}

function patchAnnotationRanges(parser: RangedParser): void {
	const key = parser as object;
	if (patchedParsers.has(key)) return;

	const createParse = parser.createParse.bind(parser);

	parser.createParse = (input, fragments, ranges) => {
		const inner = createParse(input, fragments, ranges);

		if (!hasGaps(ranges)) return inner;

		return {
			get parsedPos() {
				return inner.parsedPos;
			},

			get stoppedAt() {
				return inner.stoppedAt;
			},

			stopAt(position: number) {
				inner.stopAt(position);
			},

			advance() {
				const tree = inner.advance();
				return tree ? restoreDocumentPositions(tree, ranges) : null;
			},
		};
	};

	patchedParsers.add(key);
}

export interface SafeTypstOptions {
	enableLinting?: boolean;
}

export function safeTypst(options: SafeTypstOptions = {}): LanguageSupport {
	const support = typst_lezer();

	patchAnnotationRanges(support.language.parser as unknown as RangedParser);

	return new LanguageSupport(support.language, [
		typstLezerIndentService,
		typstLezerListKeymap,
		typstLezerFoldService,
		...(options.enableLinting === false ? [] : [typstLezerLinter]),
	]);
}
