// A safe arithmetic evaluator — no eval(), no Function(). Supports
// + - * / % ^ (power), parentheses, unary minus, and decimals.

class ParseError extends Error {}

function tokenize(expr) {
  const tokens = [];
  const re = /\s*([0-9]*\.?[0-9]+|\^|\+|-|\*|\/|%|\(|\))\s*/g;
  let match;
  let lastIndex = 0;
  while ((match = re.exec(expr)) !== null) {
    if (match.index !== lastIndex) {
      throw new ParseError(`Unexpected character near "${expr.slice(lastIndex, match.index + 1)}"`);
    }
    tokens.push(match[1]);
    lastIndex = re.lastIndex;
  }
  if (lastIndex !== expr.length) {
    throw new ParseError(`Unexpected character near "${expr.slice(lastIndex)}"`);
  }
  return tokens;
}

// Recursive-descent parser: expr -> term (('+'|'-') term)*
//                            term -> power (('*'|'/'|'%') power)*
//                            power -> unary ('^' power)?     (right-assoc)
//                            unary -> '-' unary | atom
//                            atom -> NUMBER | '(' expr ')'
function makeParser(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function atom() {
    const t = peek();
    if (t === undefined) throw new ParseError("Unexpected end of expression");
    if (t === "(") {
      next();
      const v = expr();
      if (peek() !== ")") throw new ParseError("Missing closing parenthesis");
      next();
      return v;
    }
    if (/^[0-9.]+$/.test(t)) {
      next();
      return parseFloat(t);
    }
    throw new ParseError(`Unexpected token "${t}"`);
  }

  function unary() {
    if (peek() === "-") {
      next();
      return -unary();
    }
    if (peek() === "+") {
      next();
      return unary();
    }
    return atom();
  }

  function power() {
    const base = unary();
    if (peek() === "^") {
      next();
      return Math.pow(base, power());
    }
    return base;
  }

  function term() {
    let v = power();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next();
      const rhs = power();
      if (op === "*") v *= rhs;
      else if (op === "/") {
        if (rhs === 0) throw new ParseError("Division by zero");
        v /= rhs;
      } else v %= rhs;
    }
    return v;
  }

  function expr() {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const rhs = term();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }

  return { expr, isDone: () => pos >= tokens.length };
}

export function evaluate(expression) {
  const tokens = tokenize(expression);
  const parser = makeParser(tokens);
  const result = parser.expr();
  if (!parser.isDone()) throw new ParseError("Trailing input after a complete expression");
  return result;
}

export function looksLikeMath(text) {
  // A conservative check: mostly digits/operators/parens/whitespace,
  // and at least one operator so plain numbers don't hijack every task.
  const stripped = text.trim();
  return /^[0-9.\s()+\-*/^%]+$/.test(stripped) && /[+\-*/^%]/.test(stripped);
}

const skill = {
  name: "calculator",
  description: "Evaluates a safe arithmetic expression (+ - * / % ^ and parentheses).",
  match(task) {
    return looksLikeMath(task) || /calculate|compute|what('?s| is)\s+\d/i.test(task);
  },
  needsConfirmation: false,
  async run(input) {
    // Pull the numeric expression out of a larger sentence if needed.
    const exprMatch = input.match(/[0-9.\s()+\-*/^%]{2,}/);
    const expression = (exprMatch ? exprMatch[0] : input).trim();
    const result = evaluate(expression);
    return { ok: true, output: `${expression.trim()} = ${result}` };
  },
};

export default skill;
