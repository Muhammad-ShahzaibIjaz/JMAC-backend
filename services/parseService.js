const { default: axios } = require("axios");

class IntelligentRuleParser {
  constructor() {
    this.comparisonPatterns = [
      { patterns: [/\b(greater\s+than|more\s+than|above|higher\s+than|exceeds?|over)\b/gi, /\b>\b/g], operator: '>' },
      { patterns: [/\b(less\s+than|lower\s+than|below|under)\b/gi, /\b<\b/g], operator: '<' },
      { patterns: [/\b(at\s+least|no\s+less\s+than|minimum\s+of|>=)\b/gi], operator: '>=' },
      { patterns: [/\b(at\s+most|no\s+more\s+than|maximum\s+of|<=)\b/gi], operator: '<=' },
      { patterns: [/\b(equals?|is\s+equal\s+to|==|===|matches)\b/gi], operator: '==' },
      { patterns: [/\b(not\s+equals?|is\s+not\s+equal\s+to|!=|!==|is\s+not)\b/gi], operator: '!=' },
      { patterns: [/\b(between|ranging\s+from|from\s+.*\s+to)\b/gi], operator: 'between' }
    ];

    this.logicalOperators = [
      { patterns: [/\b(and|&&)\b/gi], operator: '&&' },
      { patterns: [/\b(or|\|\|)\b/gi], operator: '||' }
    ];

    this.conditionTriggers = [/\b(if|when|should|where)\b/gi];

    this.actionTriggers = [/\b(then|set|assign|make|mark\s+as|is)\b/gi];

    this.assignmentPatterns = [
      /^(@\w+)\s+(?:is|=|equals?|should\s+be|must\s+be)\s+(.+)/i,
      /^(?:set\s+|assign\s+|mark\s+|label\s+)?(@\w+)\s+to\s+(.+)/i,
      /^(.+?)\s+(?:is\s+)?(?:assigned\s+to|set\s+for)\s+(@\w+)/i,
      /^(?:the\s+)?(?:student|person|user)\s+(?:gets?|is\s+marked\s+as)\s+(.+?)\s+(?:in|for)\s+(@\w+)/i,
      /^it's\s+(@\w+)\s+(?:is|=)\s+(.+)/i
    ];
  }

  parseRule(ruleString) {
    const ruleSegments = this.splitRuleSegments(ruleString);
    const result = {
      conditions: [],
      assignments: [],
      headers: new Set()
    };

    for (const segment of ruleSegments) {
      this.processRuleSegment(segment, result);
    }

    result.headers = Array.from(result.headers).sort();
    return result;
  }

  splitRuleSegments(ruleString) {
    let normalized = ruleString
      .replace(/[.!;]+\s*/g, '. ')
      .replace(/\s+/g, ' ')
      .trim();

    const segments = normalized.split(/(?=\s*(?:If|When|Should|Where)\s)/i);
    return segments.filter(segment => segment.trim().length > 5);
  }

  processRuleSegment(segment, result) {
    const conditionPattern = /(?:If|When|Should|Where)\s+(.+?)(?:\s+(?:then|,)\s+(.+)|$)/i;
    const match = segment.match(conditionPattern);

    if (!match) return;

    const conditionText = match[1].trim();
    const actionsText = match[2] ? match[2].trim() : '';

    const parsedCondition = this.parseCondition(conditionText);
    if (parsedCondition.expression) {
      result.conditions.push(parsedCondition.expression);
      parsedCondition.variables.forEach(v => result.headers.add(v));
    }

    if (actionsText) {
      const actions = this.parseActions(actionsText);
      for (const action of actions) {
        result.assignments.push(action.assignment);
        action.variables.forEach(v => result.headers.add(v));
      }
    }
  }

  parseCondition(conditionText) {
    let expression = conditionText.trim();
    const variables = new Set();

    expression = expression.replace(
      /(@\w+)\s+(?:is\s+)?between\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)/gi,
      (match, variable, min, max) => {
        variables.add(variable.substring(1));
        return `${variable} >= ${min} && ${variable} <= ${max}`;
      }
    );

    expression = expression.replace(
      /(@\w+)\s+(?:is\s+)?(?:greater\s+than|>)\s+(\d+(?:\.\d+)?)\s+(?:and|&&)\s+(?:less\s+than|<)\s+(\d+(?:\.\d+)?)/gi,
      (match, variable, min, max) => {
        variables.add(variable.substring(1));
        return `${variable} > ${min} && ${variable} < ${max}`;
      }
    );

    for (const { patterns, operator } of [...this.comparisonPatterns, ...this.logicalOperators]) {
      if (operator === 'between') continue;
      for (const pattern of patterns) {
        expression = expression.replace(pattern, ` ${operator} `);
      }
    }

    const varMatches = expression.match(/@\w+/g) || [];
    varMatches.forEach(v => variables.add(v.substring(1)));

    expression = expression.replace(/\s+/g, ' ').trim();
    expression = expression.replace(/\s*([><=!]=?|\&\&|\|\|)\s*/g, ' $1 ');

    return { expression, variables };
  }

  parseActions(actionsText) {
    const actions = [];
    const actionParts = actionsText.split(/(?:\s*[,;]\s*|\s+and\s+|\s+then\s+)/gi).filter(part => part.trim());

    for (let part of actionParts) {
      part = part.trim();
      if (!part) continue;

      const action = this.parseIndividualAction(part);
      if (action) {
        actions.push(action);
      }
    }

    return actions;
  }

  parseIndividualAction(actionText) {
    const variables = new Set();

    for (const pattern of this.assignmentPatterns) {
      const match = actionText.match(pattern);
      if (match) {
        let variable, value;

        if (this.assignmentPatterns.indexOf(pattern) === 2) {
          value = match[1].trim();
          variable = match[2].substring(1);
        } else if (this.assignmentPatterns.indexOf(pattern) === 3) {
          value = match[1].trim();
          variable = match[2].substring(1);
        } else if (this.assignmentPatterns.indexOf(pattern) === 4) {
          variable = match[1].substring(1);
          value = match[2].trim();
        } else {
          variable = match[1].substring(1);
          value = match[2].trim();
        }

        value = value.replace(/[.;,]+$/, '').trim();
        if (!/^(@\w+|\d+(?:\.\d+)?|true|false)$/i.test(value)) {
          value = `'${value}'`;
        }

        const varMatches = value.match(/@\w+/g) || [];
        varMatches.forEach(v => variables.add(v.substring(1)));

        variables.add(variable);
        return {
          assignment: { header: variable, value },
          variables
        };
      }
    }

    return null;
  }
}


const parseAPI = async (req, res) => {
  try {
    const { input_string } = req.body;

    const result = await axios.post(
      "http://85.192.56.243:5000/convert",
      { input_string },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!result) {
      return res.status(400).json({ error: "Something went wrong" });
    }

    res.status(200).json(result.data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};


module.exports = {
  parseRule: ruleString => new IntelligentRuleParser().parseRule(ruleString),
  parseAPI
};