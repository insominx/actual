import { currencyToAmount } from './util';

type ParserState = {
  str: string;
  index: number;
};

type Operator = '+' | '-' | '*' | '/' | '^';

type OperatorNode = {
  op: Operator;
  left: AstNode;
  right: AstNode;
};

type AstNode = number | OperatorNode;

function fail(state: ParserState, msg: string): never {
  throw new Error(
    msg + ': ' + JSON.stringify(state.str.slice(state.index, state.index + 10)),
  );
}

function char(state: ParserState): string | undefined {
  return state.str[state.index];
}

function next(state: ParserState): string | null {
  if (state.index >= state.str.length) {
    return null;
  }

  const ch = char(state);
  state.index++;
  return ch ?? null;
}

function nextOperator(state: ParserState, op: string): boolean {
  if (char(state) === op) {
    next(state);
    return true;
  }

  return false;
}

function parsePrimary(state: ParserState): number {
  // We only support numbers
  const isNegative = char(state) === '-';
  if (isNegative) {
    next(state);
  }

  let numberStr = '';
  let currentChar = char(state);
  while (
    currentChar &&
    currentChar.match(/[0-9,.'\u2019\u00A0\u202F ]|\p{Sc}/u)
  ) {
    const ch = next(state);
    if (ch !== null) {
      numberStr += ch;
    }
    currentChar = char(state);
  }

  if (numberStr === '') {
    fail(state, 'Unexpected character');
  }

  const number = currencyToAmount(numberStr);
  if (number === null) {
    fail(state, 'Invalid number format');
  }
  return isNegative ? -number : number;
}

function parseParens(state: ParserState): AstNode {
  // A leading minus on a parenthesized group, e.g. `-(2 + 3)`
  if (char(state) === '-' && state.str[state.index + 1] === '(') {
    next(state);
    return { op: '-', left: 0, right: parseParens(state) };
  }

  if (char(state) === '(') {
    next(state);
    const expr = parseOperator(state);

    if (char(state) !== ')') {
      fail(state, 'Unbalanced parentheses');
    }

    next(state);
    return expr;
  }

  return parsePrimary(state);
}

function parseExponent(state: ParserState): AstNode {
  let node = parseParens(state);
  if (nextOperator(state, '^')) {
    node = { op: '^', left: node, right: parseExponent(state) };
  }
  return node;
}

function parseMultiplicative(state: ParserState): AstNode {
  let node = parseExponent(state);
  while (char(state) === '*' || char(state) === '/') {
    const op = next(state) as '*' | '/';
    node = { op, left: node, right: parseExponent(state) };
  }
  return node;
}

function parseAdditive(state: ParserState): AstNode {
  let node = parseMultiplicative(state);
  // `45-` is an accounting negative, not subtraction with a missing
  // right-hand side. Only a bare number gets that reading; `10+20-`
  // is still an unfinished expression.
  if (
    typeof node === 'number' &&
    char(state) === '-' &&
    state.index === state.str.length - 1
  ) {
    next(state);
    return -node;
  }
  while (char(state) === '+' || char(state) === '-') {
    const op = next(state) as '+' | '-';
    node = { op, left: node, right: parseMultiplicative(state) };
  }
  return node;
}

// These operators go from high to low order of precedence
const parseOperator = parseAdditive;

function parse(expression: string): AstNode {
  const state = {
    str: expression.replace(/\u2212/g, '-').replace(/\s/g, ''),
    index: 0,
  };
  return parseOperator(state);
}

function evaluate(ast: AstNode): number {
  if (typeof ast === 'number') {
    return ast;
  }

  const { left, right, op } = ast;

  switch (op) {
    case '+':
      return evaluate(left) + evaluate(right);
    case '-':
      return evaluate(left) - evaluate(right);
    case '*':
      return evaluate(left) * evaluate(right);
    case '/':
      return evaluate(left) / evaluate(right);
    case '^':
      return Math.pow(evaluate(left), evaluate(right));
    default:
      throw new Error('Unknown operator: ' + op);
  }
}

export function evalArithmetic(
  expression: string,
  defaultValue: number | null = null,
): number | null {
  // An empty expression always evals to the default
  if (expression === '') {
    return defaultValue;
  }

  let result: number;
  try {
    result = evaluate(parse(expression));
  } catch {
    // If it errors, return the default value
    return defaultValue;
  }

  // NaN and Infinity cannot be stored as an amount. `1/0` is Infinity.
  return Number.isFinite(result) ? result : defaultValue;
}
