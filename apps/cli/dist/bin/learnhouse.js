#!/usr/bin/env node
import { createRequire as __createRequire } from "module";
const require = __createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x2) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x2, {
  get: (a3, b3) => (typeof require !== "undefined" ? require : a3)[b3]
}) : x2)(function(x2) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x2 + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/error.js
var require_error = __commonJS({
  "node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/error.js"(exports) {
    "use strict";
    var CommanderError2 = class extends Error {
      /**
       * Constructs the CommanderError class
       * @param {number} exitCode suggested exit code which could be used with process.exit
       * @param {string} code an id string representing the error
       * @param {string} message human-readable description of the error
       */
      constructor(exitCode, code, message) {
        super(message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
        this.code = code;
        this.exitCode = exitCode;
        this.nestedError = void 0;
      }
    };
    var InvalidArgumentError2 = class extends CommanderError2 {
      /**
       * Constructs the InvalidArgumentError class
       * @param {string} [message] explanation of why argument is invalid
       */
      constructor(message) {
        super(1, "commander.invalidArgument", message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
      }
    };
    exports.CommanderError = CommanderError2;
    exports.InvalidArgumentError = InvalidArgumentError2;
  }
});

// node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/argument.js
var require_argument = __commonJS({
  "node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/argument.js"(exports) {
    "use strict";
    var { InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var Argument2 = class {
      /**
       * Initialize a new command argument with the given name and description.
       * The default is that the argument is required, and you can explicitly
       * indicate this with <> around the name. Put [] around the name for an optional argument.
       *
       * @param {string} name
       * @param {string} [description]
       */
      constructor(name, description) {
        this.description = description || "";
        this.variadic = false;
        this.parseArg = void 0;
        this.defaultValue = void 0;
        this.defaultValueDescription = void 0;
        this.argChoices = void 0;
        switch (name[0]) {
          case "<":
            this.required = true;
            this._name = name.slice(1, -1);
            break;
          case "[":
            this.required = false;
            this._name = name.slice(1, -1);
            break;
          default:
            this.required = true;
            this._name = name;
            break;
        }
        if (this._name.length > 3 && this._name.slice(-3) === "...") {
          this.variadic = true;
          this._name = this._name.slice(0, -3);
        }
      }
      /**
       * Return argument name.
       *
       * @return {string}
       */
      name() {
        return this._name;
      }
      /**
       * @package
       */
      _concatValue(value, previous) {
        if (previous === this.defaultValue || !Array.isArray(previous)) {
          return [value];
        }
        return previous.concat(value);
      }
      /**
       * Set the default value, and optionally supply the description to be displayed in the help.
       *
       * @param {*} value
       * @param {string} [description]
       * @return {Argument}
       */
      default(value, description) {
        this.defaultValue = value;
        this.defaultValueDescription = description;
        return this;
      }
      /**
       * Set the custom handler for processing CLI command arguments into argument values.
       *
       * @param {Function} [fn]
       * @return {Argument}
       */
      argParser(fn) {
        this.parseArg = fn;
        return this;
      }
      /**
       * Only allow argument value to be one of choices.
       *
       * @param {string[]} values
       * @return {Argument}
       */
      choices(values) {
        this.argChoices = values.slice();
        this.parseArg = (arg, previous) => {
          if (!this.argChoices.includes(arg)) {
            throw new InvalidArgumentError2(
              `Allowed choices are ${this.argChoices.join(", ")}.`
            );
          }
          if (this.variadic) {
            return this._concatValue(arg, previous);
          }
          return arg;
        };
        return this;
      }
      /**
       * Make argument required.
       *
       * @returns {Argument}
       */
      argRequired() {
        this.required = true;
        return this;
      }
      /**
       * Make argument optional.
       *
       * @returns {Argument}
       */
      argOptional() {
        this.required = false;
        return this;
      }
    };
    function humanReadableArgName(arg) {
      const nameOutput = arg.name() + (arg.variadic === true ? "..." : "");
      return arg.required ? "<" + nameOutput + ">" : "[" + nameOutput + "]";
    }
    exports.Argument = Argument2;
    exports.humanReadableArgName = humanReadableArgName;
  }
});

// node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/help.js
var require_help = __commonJS({
  "node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/help.js"(exports) {
    "use strict";
    var { humanReadableArgName } = require_argument();
    var Help2 = class {
      constructor() {
        this.helpWidth = void 0;
        this.sortSubcommands = false;
        this.sortOptions = false;
        this.showGlobalOptions = false;
      }
      /**
       * Get an array of the visible subcommands. Includes a placeholder for the implicit help command, if there is one.
       *
       * @param {Command} cmd
       * @returns {Command[]}
       */
      visibleCommands(cmd) {
        const visibleCommands = cmd.commands.filter((cmd2) => !cmd2._hidden);
        const helpCommand = cmd._getHelpCommand();
        if (helpCommand && !helpCommand._hidden) {
          visibleCommands.push(helpCommand);
        }
        if (this.sortSubcommands) {
          visibleCommands.sort((a3, b3) => {
            return a3.name().localeCompare(b3.name());
          });
        }
        return visibleCommands;
      }
      /**
       * Compare options for sort.
       *
       * @param {Option} a
       * @param {Option} b
       * @returns {number}
       */
      compareOptions(a3, b3) {
        const getSortKey = (option) => {
          return option.short ? option.short.replace(/^-/, "") : option.long.replace(/^--/, "");
        };
        return getSortKey(a3).localeCompare(getSortKey(b3));
      }
      /**
       * Get an array of the visible options. Includes a placeholder for the implicit help option, if there is one.
       *
       * @param {Command} cmd
       * @returns {Option[]}
       */
      visibleOptions(cmd) {
        const visibleOptions = cmd.options.filter((option) => !option.hidden);
        const helpOption = cmd._getHelpOption();
        if (helpOption && !helpOption.hidden) {
          const removeShort = helpOption.short && cmd._findOption(helpOption.short);
          const removeLong = helpOption.long && cmd._findOption(helpOption.long);
          if (!removeShort && !removeLong) {
            visibleOptions.push(helpOption);
          } else if (helpOption.long && !removeLong) {
            visibleOptions.push(
              cmd.createOption(helpOption.long, helpOption.description)
            );
          } else if (helpOption.short && !removeShort) {
            visibleOptions.push(
              cmd.createOption(helpOption.short, helpOption.description)
            );
          }
        }
        if (this.sortOptions) {
          visibleOptions.sort(this.compareOptions);
        }
        return visibleOptions;
      }
      /**
       * Get an array of the visible global options. (Not including help.)
       *
       * @param {Command} cmd
       * @returns {Option[]}
       */
      visibleGlobalOptions(cmd) {
        if (!this.showGlobalOptions) return [];
        const globalOptions = [];
        for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) {
          const visibleOptions = ancestorCmd.options.filter(
            (option) => !option.hidden
          );
          globalOptions.push(...visibleOptions);
        }
        if (this.sortOptions) {
          globalOptions.sort(this.compareOptions);
        }
        return globalOptions;
      }
      /**
       * Get an array of the arguments if any have a description.
       *
       * @param {Command} cmd
       * @returns {Argument[]}
       */
      visibleArguments(cmd) {
        if (cmd._argsDescription) {
          cmd.registeredArguments.forEach((argument) => {
            argument.description = argument.description || cmd._argsDescription[argument.name()] || "";
          });
        }
        if (cmd.registeredArguments.find((argument) => argument.description)) {
          return cmd.registeredArguments;
        }
        return [];
      }
      /**
       * Get the command term to show in the list of subcommands.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      subcommandTerm(cmd) {
        const args = cmd.registeredArguments.map((arg) => humanReadableArgName(arg)).join(" ");
        return cmd._name + (cmd._aliases[0] ? "|" + cmd._aliases[0] : "") + (cmd.options.length ? " [options]" : "") + // simplistic check for non-help option
        (args ? " " + args : "");
      }
      /**
       * Get the option term to show in the list of options.
       *
       * @param {Option} option
       * @returns {string}
       */
      optionTerm(option) {
        return option.flags;
      }
      /**
       * Get the argument term to show in the list of arguments.
       *
       * @param {Argument} argument
       * @returns {string}
       */
      argumentTerm(argument) {
        return argument.name();
      }
      /**
       * Get the longest command term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestSubcommandTermLength(cmd, helper) {
        return helper.visibleCommands(cmd).reduce((max, command) => {
          return Math.max(max, helper.subcommandTerm(command).length);
        }, 0);
      }
      /**
       * Get the longest option term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestOptionTermLength(cmd, helper) {
        return helper.visibleOptions(cmd).reduce((max, option) => {
          return Math.max(max, helper.optionTerm(option).length);
        }, 0);
      }
      /**
       * Get the longest global option term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestGlobalOptionTermLength(cmd, helper) {
        return helper.visibleGlobalOptions(cmd).reduce((max, option) => {
          return Math.max(max, helper.optionTerm(option).length);
        }, 0);
      }
      /**
       * Get the longest argument term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestArgumentTermLength(cmd, helper) {
        return helper.visibleArguments(cmd).reduce((max, argument) => {
          return Math.max(max, helper.argumentTerm(argument).length);
        }, 0);
      }
      /**
       * Get the command usage to be displayed at the top of the built-in help.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      commandUsage(cmd) {
        let cmdName = cmd._name;
        if (cmd._aliases[0]) {
          cmdName = cmdName + "|" + cmd._aliases[0];
        }
        let ancestorCmdNames = "";
        for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) {
          ancestorCmdNames = ancestorCmd.name() + " " + ancestorCmdNames;
        }
        return ancestorCmdNames + cmdName + " " + cmd.usage();
      }
      /**
       * Get the description for the command.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      commandDescription(cmd) {
        return cmd.description();
      }
      /**
       * Get the subcommand summary to show in the list of subcommands.
       * (Fallback to description for backwards compatibility.)
       *
       * @param {Command} cmd
       * @returns {string}
       */
      subcommandDescription(cmd) {
        return cmd.summary() || cmd.description();
      }
      /**
       * Get the option description to show in the list of options.
       *
       * @param {Option} option
       * @return {string}
       */
      optionDescription(option) {
        const extraInfo = [];
        if (option.argChoices) {
          extraInfo.push(
            // use stringify to match the display of the default value
            `choices: ${option.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`
          );
        }
        if (option.defaultValue !== void 0) {
          const showDefault = option.required || option.optional || option.isBoolean() && typeof option.defaultValue === "boolean";
          if (showDefault) {
            extraInfo.push(
              `default: ${option.defaultValueDescription || JSON.stringify(option.defaultValue)}`
            );
          }
        }
        if (option.presetArg !== void 0 && option.optional) {
          extraInfo.push(`preset: ${JSON.stringify(option.presetArg)}`);
        }
        if (option.envVar !== void 0) {
          extraInfo.push(`env: ${option.envVar}`);
        }
        if (extraInfo.length > 0) {
          return `${option.description} (${extraInfo.join(", ")})`;
        }
        return option.description;
      }
      /**
       * Get the argument description to show in the list of arguments.
       *
       * @param {Argument} argument
       * @return {string}
       */
      argumentDescription(argument) {
        const extraInfo = [];
        if (argument.argChoices) {
          extraInfo.push(
            // use stringify to match the display of the default value
            `choices: ${argument.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`
          );
        }
        if (argument.defaultValue !== void 0) {
          extraInfo.push(
            `default: ${argument.defaultValueDescription || JSON.stringify(argument.defaultValue)}`
          );
        }
        if (extraInfo.length > 0) {
          const extraDescripton = `(${extraInfo.join(", ")})`;
          if (argument.description) {
            return `${argument.description} ${extraDescripton}`;
          }
          return extraDescripton;
        }
        return argument.description;
      }
      /**
       * Generate the built-in help text.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {string}
       */
      formatHelp(cmd, helper) {
        const termWidth = helper.padWidth(cmd, helper);
        const helpWidth = helper.helpWidth || 80;
        const itemIndentWidth = 2;
        const itemSeparatorWidth = 2;
        function formatItem(term, description) {
          if (description) {
            const fullText = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`;
            return helper.wrap(
              fullText,
              helpWidth - itemIndentWidth,
              termWidth + itemSeparatorWidth
            );
          }
          return term;
        }
        function formatList(textArray) {
          return textArray.join("\n").replace(/^/gm, " ".repeat(itemIndentWidth));
        }
        let output = [`Usage: ${helper.commandUsage(cmd)}`, ""];
        const commandDescription = helper.commandDescription(cmd);
        if (commandDescription.length > 0) {
          output = output.concat([
            helper.wrap(commandDescription, helpWidth, 0),
            ""
          ]);
        }
        const argumentList = helper.visibleArguments(cmd).map((argument) => {
          return formatItem(
            helper.argumentTerm(argument),
            helper.argumentDescription(argument)
          );
        });
        if (argumentList.length > 0) {
          output = output.concat(["Arguments:", formatList(argumentList), ""]);
        }
        const optionList = helper.visibleOptions(cmd).map((option) => {
          return formatItem(
            helper.optionTerm(option),
            helper.optionDescription(option)
          );
        });
        if (optionList.length > 0) {
          output = output.concat(["Options:", formatList(optionList), ""]);
        }
        if (this.showGlobalOptions) {
          const globalOptionList = helper.visibleGlobalOptions(cmd).map((option) => {
            return formatItem(
              helper.optionTerm(option),
              helper.optionDescription(option)
            );
          });
          if (globalOptionList.length > 0) {
            output = output.concat([
              "Global Options:",
              formatList(globalOptionList),
              ""
            ]);
          }
        }
        const commandList = helper.visibleCommands(cmd).map((cmd2) => {
          return formatItem(
            helper.subcommandTerm(cmd2),
            helper.subcommandDescription(cmd2)
          );
        });
        if (commandList.length > 0) {
          output = output.concat(["Commands:", formatList(commandList), ""]);
        }
        return output.join("\n");
      }
      /**
       * Calculate the pad width from the maximum term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      padWidth(cmd, helper) {
        return Math.max(
          helper.longestOptionTermLength(cmd, helper),
          helper.longestGlobalOptionTermLength(cmd, helper),
          helper.longestSubcommandTermLength(cmd, helper),
          helper.longestArgumentTermLength(cmd, helper)
        );
      }
      /**
       * Wrap the given string to width characters per line, with lines after the first indented.
       * Do not wrap if insufficient room for wrapping (minColumnWidth), or string is manually formatted.
       *
       * @param {string} str
       * @param {number} width
       * @param {number} indent
       * @param {number} [minColumnWidth=40]
       * @return {string}
       *
       */
      wrap(str, width, indent, minColumnWidth = 40) {
        const indents = " \\f\\t\\v\xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF";
        const manualIndent = new RegExp(`[\\n][${indents}]+`);
        if (str.match(manualIndent)) return str;
        const columnWidth = width - indent;
        if (columnWidth < minColumnWidth) return str;
        const leadingStr = str.slice(0, indent);
        const columnText = str.slice(indent).replace("\r\n", "\n");
        const indentString = " ".repeat(indent);
        const zeroWidthSpace = "\u200B";
        const breaks = `\\s${zeroWidthSpace}`;
        const regex = new RegExp(
          `
|.{1,${columnWidth - 1}}([${breaks}]|$)|[^${breaks}]+?([${breaks}]|$)`,
          "g"
        );
        const lines = columnText.match(regex) || [];
        return leadingStr + lines.map((line, i) => {
          if (line === "\n") return "";
          return (i > 0 ? indentString : "") + line.trimEnd();
        }).join("\n");
      }
    };
    exports.Help = Help2;
  }
});

// node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/option.js
var require_option = __commonJS({
  "node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/option.js"(exports) {
    "use strict";
    var { InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var Option2 = class {
      /**
       * Initialize a new `Option` with the given `flags` and `description`.
       *
       * @param {string} flags
       * @param {string} [description]
       */
      constructor(flags, description) {
        this.flags = flags;
        this.description = description || "";
        this.required = flags.includes("<");
        this.optional = flags.includes("[");
        this.variadic = /\w\.\.\.[>\]]$/.test(flags);
        this.mandatory = false;
        const optionFlags = splitOptionFlags(flags);
        this.short = optionFlags.shortFlag;
        this.long = optionFlags.longFlag;
        this.negate = false;
        if (this.long) {
          this.negate = this.long.startsWith("--no-");
        }
        this.defaultValue = void 0;
        this.defaultValueDescription = void 0;
        this.presetArg = void 0;
        this.envVar = void 0;
        this.parseArg = void 0;
        this.hidden = false;
        this.argChoices = void 0;
        this.conflictsWith = [];
        this.implied = void 0;
      }
      /**
       * Set the default value, and optionally supply the description to be displayed in the help.
       *
       * @param {*} value
       * @param {string} [description]
       * @return {Option}
       */
      default(value, description) {
        this.defaultValue = value;
        this.defaultValueDescription = description;
        return this;
      }
      /**
       * Preset to use when option used without option-argument, especially optional but also boolean and negated.
       * The custom processing (parseArg) is called.
       *
       * @example
       * new Option('--color').default('GREYSCALE').preset('RGB');
       * new Option('--donate [amount]').preset('20').argParser(parseFloat);
       *
       * @param {*} arg
       * @return {Option}
       */
      preset(arg) {
        this.presetArg = arg;
        return this;
      }
      /**
       * Add option name(s) that conflict with this option.
       * An error will be displayed if conflicting options are found during parsing.
       *
       * @example
       * new Option('--rgb').conflicts('cmyk');
       * new Option('--js').conflicts(['ts', 'jsx']);
       *
       * @param {(string | string[])} names
       * @return {Option}
       */
      conflicts(names) {
        this.conflictsWith = this.conflictsWith.concat(names);
        return this;
      }
      /**
       * Specify implied option values for when this option is set and the implied options are not.
       *
       * The custom processing (parseArg) is not called on the implied values.
       *
       * @example
       * program
       *   .addOption(new Option('--log', 'write logging information to file'))
       *   .addOption(new Option('--trace', 'log extra details').implies({ log: 'trace.txt' }));
       *
       * @param {object} impliedOptionValues
       * @return {Option}
       */
      implies(impliedOptionValues) {
        let newImplied = impliedOptionValues;
        if (typeof impliedOptionValues === "string") {
          newImplied = { [impliedOptionValues]: true };
        }
        this.implied = Object.assign(this.implied || {}, newImplied);
        return this;
      }
      /**
       * Set environment variable to check for option value.
       *
       * An environment variable is only used if when processed the current option value is
       * undefined, or the source of the current value is 'default' or 'config' or 'env'.
       *
       * @param {string} name
       * @return {Option}
       */
      env(name) {
        this.envVar = name;
        return this;
      }
      /**
       * Set the custom handler for processing CLI option arguments into option values.
       *
       * @param {Function} [fn]
       * @return {Option}
       */
      argParser(fn) {
        this.parseArg = fn;
        return this;
      }
      /**
       * Whether the option is mandatory and must have a value after parsing.
       *
       * @param {boolean} [mandatory=true]
       * @return {Option}
       */
      makeOptionMandatory(mandatory = true) {
        this.mandatory = !!mandatory;
        return this;
      }
      /**
       * Hide option in help.
       *
       * @param {boolean} [hide=true]
       * @return {Option}
       */
      hideHelp(hide = true) {
        this.hidden = !!hide;
        return this;
      }
      /**
       * @package
       */
      _concatValue(value, previous) {
        if (previous === this.defaultValue || !Array.isArray(previous)) {
          return [value];
        }
        return previous.concat(value);
      }
      /**
       * Only allow option value to be one of choices.
       *
       * @param {string[]} values
       * @return {Option}
       */
      choices(values) {
        this.argChoices = values.slice();
        this.parseArg = (arg, previous) => {
          if (!this.argChoices.includes(arg)) {
            throw new InvalidArgumentError2(
              `Allowed choices are ${this.argChoices.join(", ")}.`
            );
          }
          if (this.variadic) {
            return this._concatValue(arg, previous);
          }
          return arg;
        };
        return this;
      }
      /**
       * Return option name.
       *
       * @return {string}
       */
      name() {
        if (this.long) {
          return this.long.replace(/^--/, "");
        }
        return this.short.replace(/^-/, "");
      }
      /**
       * Return option name, in a camelcase format that can be used
       * as a object attribute key.
       *
       * @return {string}
       */
      attributeName() {
        return camelcase(this.name().replace(/^no-/, ""));
      }
      /**
       * Check if `arg` matches the short or long flag.
       *
       * @param {string} arg
       * @return {boolean}
       * @package
       */
      is(arg) {
        return this.short === arg || this.long === arg;
      }
      /**
       * Return whether a boolean option.
       *
       * Options are one of boolean, negated, required argument, or optional argument.
       *
       * @return {boolean}
       * @package
       */
      isBoolean() {
        return !this.required && !this.optional && !this.negate;
      }
    };
    var DualOptions = class {
      /**
       * @param {Option[]} options
       */
      constructor(options) {
        this.positiveOptions = /* @__PURE__ */ new Map();
        this.negativeOptions = /* @__PURE__ */ new Map();
        this.dualOptions = /* @__PURE__ */ new Set();
        options.forEach((option) => {
          if (option.negate) {
            this.negativeOptions.set(option.attributeName(), option);
          } else {
            this.positiveOptions.set(option.attributeName(), option);
          }
        });
        this.negativeOptions.forEach((value, key) => {
          if (this.positiveOptions.has(key)) {
            this.dualOptions.add(key);
          }
        });
      }
      /**
       * Did the value come from the option, and not from possible matching dual option?
       *
       * @param {*} value
       * @param {Option} option
       * @returns {boolean}
       */
      valueFromOption(value, option) {
        const optionKey = option.attributeName();
        if (!this.dualOptions.has(optionKey)) return true;
        const preset = this.negativeOptions.get(optionKey).presetArg;
        const negativeValue = preset !== void 0 ? preset : false;
        return option.negate === (negativeValue === value);
      }
    };
    function camelcase(str) {
      return str.split("-").reduce((str2, word) => {
        return str2 + word[0].toUpperCase() + word.slice(1);
      });
    }
    function splitOptionFlags(flags) {
      let shortFlag;
      let longFlag;
      const flagParts = flags.split(/[ |,]+/);
      if (flagParts.length > 1 && !/^[[<]/.test(flagParts[1]))
        shortFlag = flagParts.shift();
      longFlag = flagParts.shift();
      if (!shortFlag && /^-[^-]$/.test(longFlag)) {
        shortFlag = longFlag;
        longFlag = void 0;
      }
      return { shortFlag, longFlag };
    }
    exports.Option = Option2;
    exports.DualOptions = DualOptions;
  }
});

// node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/suggestSimilar.js
var require_suggestSimilar = __commonJS({
  "node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/suggestSimilar.js"(exports) {
    "use strict";
    var maxDistance = 3;
    function editDistance(a3, b3) {
      if (Math.abs(a3.length - b3.length) > maxDistance)
        return Math.max(a3.length, b3.length);
      const d2 = [];
      for (let i = 0; i <= a3.length; i++) {
        d2[i] = [i];
      }
      for (let j3 = 0; j3 <= b3.length; j3++) {
        d2[0][j3] = j3;
      }
      for (let j3 = 1; j3 <= b3.length; j3++) {
        for (let i = 1; i <= a3.length; i++) {
          let cost = 1;
          if (a3[i - 1] === b3[j3 - 1]) {
            cost = 0;
          } else {
            cost = 1;
          }
          d2[i][j3] = Math.min(
            d2[i - 1][j3] + 1,
            // deletion
            d2[i][j3 - 1] + 1,
            // insertion
            d2[i - 1][j3 - 1] + cost
            // substitution
          );
          if (i > 1 && j3 > 1 && a3[i - 1] === b3[j3 - 2] && a3[i - 2] === b3[j3 - 1]) {
            d2[i][j3] = Math.min(d2[i][j3], d2[i - 2][j3 - 2] + 1);
          }
        }
      }
      return d2[a3.length][b3.length];
    }
    function suggestSimilar(word, candidates) {
      if (!candidates || candidates.length === 0) return "";
      candidates = Array.from(new Set(candidates));
      const searchingOptions = word.startsWith("--");
      if (searchingOptions) {
        word = word.slice(2);
        candidates = candidates.map((candidate) => candidate.slice(2));
      }
      let similar = [];
      let bestDistance = maxDistance;
      const minSimilarity = 0.4;
      candidates.forEach((candidate) => {
        if (candidate.length <= 1) return;
        const distance = editDistance(word, candidate);
        const length = Math.max(word.length, candidate.length);
        const similarity = (length - distance) / length;
        if (similarity > minSimilarity) {
          if (distance < bestDistance) {
            bestDistance = distance;
            similar = [candidate];
          } else if (distance === bestDistance) {
            similar.push(candidate);
          }
        }
      });
      similar.sort((a3, b3) => a3.localeCompare(b3));
      if (searchingOptions) {
        similar = similar.map((candidate) => `--${candidate}`);
      }
      if (similar.length > 1) {
        return `
(Did you mean one of ${similar.join(", ")}?)`;
      }
      if (similar.length === 1) {
        return `
(Did you mean ${similar[0]}?)`;
      }
      return "";
    }
    exports.suggestSimilar = suggestSimilar;
  }
});

// node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/command.js
var require_command = __commonJS({
  "node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/command.js"(exports) {
    "use strict";
    var EventEmitter = __require("events").EventEmitter;
    var childProcess = __require("child_process");
    var path7 = __require("path");
    var fs7 = __require("fs");
    var process2 = __require("process");
    var { Argument: Argument2, humanReadableArgName } = require_argument();
    var { CommanderError: CommanderError2 } = require_error();
    var { Help: Help2 } = require_help();
    var { Option: Option2, DualOptions } = require_option();
    var { suggestSimilar } = require_suggestSimilar();
    var Command2 = class _Command extends EventEmitter {
      /**
       * Initialize a new `Command`.
       *
       * @param {string} [name]
       */
      constructor(name) {
        super();
        this.commands = [];
        this.options = [];
        this.parent = null;
        this._allowUnknownOption = false;
        this._allowExcessArguments = true;
        this.registeredArguments = [];
        this._args = this.registeredArguments;
        this.args = [];
        this.rawArgs = [];
        this.processedArgs = [];
        this._scriptPath = null;
        this._name = name || "";
        this._optionValues = {};
        this._optionValueSources = {};
        this._storeOptionsAsProperties = false;
        this._actionHandler = null;
        this._executableHandler = false;
        this._executableFile = null;
        this._executableDir = null;
        this._defaultCommandName = null;
        this._exitCallback = null;
        this._aliases = [];
        this._combineFlagAndOptionalValue = true;
        this._description = "";
        this._summary = "";
        this._argsDescription = void 0;
        this._enablePositionalOptions = false;
        this._passThroughOptions = false;
        this._lifeCycleHooks = {};
        this._showHelpAfterError = false;
        this._showSuggestionAfterError = true;
        this._outputConfiguration = {
          writeOut: (str) => process2.stdout.write(str),
          writeErr: (str) => process2.stderr.write(str),
          getOutHelpWidth: () => process2.stdout.isTTY ? process2.stdout.columns : void 0,
          getErrHelpWidth: () => process2.stderr.isTTY ? process2.stderr.columns : void 0,
          outputError: (str, write) => write(str)
        };
        this._hidden = false;
        this._helpOption = void 0;
        this._addImplicitHelpCommand = void 0;
        this._helpCommand = void 0;
        this._helpConfiguration = {};
      }
      /**
       * Copy settings that are useful to have in common across root command and subcommands.
       *
       * (Used internally when adding a command using `.command()` so subcommands inherit parent settings.)
       *
       * @param {Command} sourceCommand
       * @return {Command} `this` command for chaining
       */
      copyInheritedSettings(sourceCommand) {
        this._outputConfiguration = sourceCommand._outputConfiguration;
        this._helpOption = sourceCommand._helpOption;
        this._helpCommand = sourceCommand._helpCommand;
        this._helpConfiguration = sourceCommand._helpConfiguration;
        this._exitCallback = sourceCommand._exitCallback;
        this._storeOptionsAsProperties = sourceCommand._storeOptionsAsProperties;
        this._combineFlagAndOptionalValue = sourceCommand._combineFlagAndOptionalValue;
        this._allowExcessArguments = sourceCommand._allowExcessArguments;
        this._enablePositionalOptions = sourceCommand._enablePositionalOptions;
        this._showHelpAfterError = sourceCommand._showHelpAfterError;
        this._showSuggestionAfterError = sourceCommand._showSuggestionAfterError;
        return this;
      }
      /**
       * @returns {Command[]}
       * @private
       */
      _getCommandAndAncestors() {
        const result = [];
        for (let command = this; command; command = command.parent) {
          result.push(command);
        }
        return result;
      }
      /**
       * Define a command.
       *
       * There are two styles of command: pay attention to where to put the description.
       *
       * @example
       * // Command implemented using action handler (description is supplied separately to `.command`)
       * program
       *   .command('clone <source> [destination]')
       *   .description('clone a repository into a newly created directory')
       *   .action((source, destination) => {
       *     console.log('clone command called');
       *   });
       *
       * // Command implemented using separate executable file (description is second parameter to `.command`)
       * program
       *   .command('start <service>', 'start named service')
       *   .command('stop [service]', 'stop named service, or all if no name supplied');
       *
       * @param {string} nameAndArgs - command name and arguments, args are `<required>` or `[optional]` and last may also be `variadic...`
       * @param {(object | string)} [actionOptsOrExecDesc] - configuration options (for action), or description (for executable)
       * @param {object} [execOpts] - configuration options (for executable)
       * @return {Command} returns new command for action handler, or `this` for executable command
       */
      command(nameAndArgs, actionOptsOrExecDesc, execOpts) {
        let desc = actionOptsOrExecDesc;
        let opts = execOpts;
        if (typeof desc === "object" && desc !== null) {
          opts = desc;
          desc = null;
        }
        opts = opts || {};
        const [, name, args] = nameAndArgs.match(/([^ ]+) *(.*)/);
        const cmd = this.createCommand(name);
        if (desc) {
          cmd.description(desc);
          cmd._executableHandler = true;
        }
        if (opts.isDefault) this._defaultCommandName = cmd._name;
        cmd._hidden = !!(opts.noHelp || opts.hidden);
        cmd._executableFile = opts.executableFile || null;
        if (args) cmd.arguments(args);
        this._registerCommand(cmd);
        cmd.parent = this;
        cmd.copyInheritedSettings(this);
        if (desc) return this;
        return cmd;
      }
      /**
       * Factory routine to create a new unattached command.
       *
       * See .command() for creating an attached subcommand, which uses this routine to
       * create the command. You can override createCommand to customise subcommands.
       *
       * @param {string} [name]
       * @return {Command} new command
       */
      createCommand(name) {
        return new _Command(name);
      }
      /**
       * You can customise the help with a subclass of Help by overriding createHelp,
       * or by overriding Help properties using configureHelp().
       *
       * @return {Help}
       */
      createHelp() {
        return Object.assign(new Help2(), this.configureHelp());
      }
      /**
       * You can customise the help by overriding Help properties using configureHelp(),
       * or with a subclass of Help by overriding createHelp().
       *
       * @param {object} [configuration] - configuration options
       * @return {(Command | object)} `this` command for chaining, or stored configuration
       */
      configureHelp(configuration) {
        if (configuration === void 0) return this._helpConfiguration;
        this._helpConfiguration = configuration;
        return this;
      }
      /**
       * The default output goes to stdout and stderr. You can customise this for special
       * applications. You can also customise the display of errors by overriding outputError.
       *
       * The configuration properties are all functions:
       *
       *     // functions to change where being written, stdout and stderr
       *     writeOut(str)
       *     writeErr(str)
       *     // matching functions to specify width for wrapping help
       *     getOutHelpWidth()
       *     getErrHelpWidth()
       *     // functions based on what is being written out
       *     outputError(str, write) // used for displaying errors, and not used for displaying help
       *
       * @param {object} [configuration] - configuration options
       * @return {(Command | object)} `this` command for chaining, or stored configuration
       */
      configureOutput(configuration) {
        if (configuration === void 0) return this._outputConfiguration;
        Object.assign(this._outputConfiguration, configuration);
        return this;
      }
      /**
       * Display the help or a custom message after an error occurs.
       *
       * @param {(boolean|string)} [displayHelp]
       * @return {Command} `this` command for chaining
       */
      showHelpAfterError(displayHelp = true) {
        if (typeof displayHelp !== "string") displayHelp = !!displayHelp;
        this._showHelpAfterError = displayHelp;
        return this;
      }
      /**
       * Display suggestion of similar commands for unknown commands, or options for unknown options.
       *
       * @param {boolean} [displaySuggestion]
       * @return {Command} `this` command for chaining
       */
      showSuggestionAfterError(displaySuggestion = true) {
        this._showSuggestionAfterError = !!displaySuggestion;
        return this;
      }
      /**
       * Add a prepared subcommand.
       *
       * See .command() for creating an attached subcommand which inherits settings from its parent.
       *
       * @param {Command} cmd - new subcommand
       * @param {object} [opts] - configuration options
       * @return {Command} `this` command for chaining
       */
      addCommand(cmd, opts) {
        if (!cmd._name) {
          throw new Error(`Command passed to .addCommand() must have a name
- specify the name in Command constructor or using .name()`);
        }
        opts = opts || {};
        if (opts.isDefault) this._defaultCommandName = cmd._name;
        if (opts.noHelp || opts.hidden) cmd._hidden = true;
        this._registerCommand(cmd);
        cmd.parent = this;
        cmd._checkForBrokenPassThrough();
        return this;
      }
      /**
       * Factory routine to create a new unattached argument.
       *
       * See .argument() for creating an attached argument, which uses this routine to
       * create the argument. You can override createArgument to return a custom argument.
       *
       * @param {string} name
       * @param {string} [description]
       * @return {Argument} new argument
       */
      createArgument(name, description) {
        return new Argument2(name, description);
      }
      /**
       * Define argument syntax for command.
       *
       * The default is that the argument is required, and you can explicitly
       * indicate this with <> around the name. Put [] around the name for an optional argument.
       *
       * @example
       * program.argument('<input-file>');
       * program.argument('[output-file]');
       *
       * @param {string} name
       * @param {string} [description]
       * @param {(Function|*)} [fn] - custom argument processing function
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      argument(name, description, fn, defaultValue) {
        const argument = this.createArgument(name, description);
        if (typeof fn === "function") {
          argument.default(defaultValue).argParser(fn);
        } else {
          argument.default(fn);
        }
        this.addArgument(argument);
        return this;
      }
      /**
       * Define argument syntax for command, adding multiple at once (without descriptions).
       *
       * See also .argument().
       *
       * @example
       * program.arguments('<cmd> [env]');
       *
       * @param {string} names
       * @return {Command} `this` command for chaining
       */
      arguments(names) {
        names.trim().split(/ +/).forEach((detail) => {
          this.argument(detail);
        });
        return this;
      }
      /**
       * Define argument syntax for command, adding a prepared argument.
       *
       * @param {Argument} argument
       * @return {Command} `this` command for chaining
       */
      addArgument(argument) {
        const previousArgument = this.registeredArguments.slice(-1)[0];
        if (previousArgument && previousArgument.variadic) {
          throw new Error(
            `only the last argument can be variadic '${previousArgument.name()}'`
          );
        }
        if (argument.required && argument.defaultValue !== void 0 && argument.parseArg === void 0) {
          throw new Error(
            `a default value for a required argument is never used: '${argument.name()}'`
          );
        }
        this.registeredArguments.push(argument);
        return this;
      }
      /**
       * Customise or override default help command. By default a help command is automatically added if your command has subcommands.
       *
       * @example
       *    program.helpCommand('help [cmd]');
       *    program.helpCommand('help [cmd]', 'show help');
       *    program.helpCommand(false); // suppress default help command
       *    program.helpCommand(true); // add help command even if no subcommands
       *
       * @param {string|boolean} enableOrNameAndArgs - enable with custom name and/or arguments, or boolean to override whether added
       * @param {string} [description] - custom description
       * @return {Command} `this` command for chaining
       */
      helpCommand(enableOrNameAndArgs, description) {
        if (typeof enableOrNameAndArgs === "boolean") {
          this._addImplicitHelpCommand = enableOrNameAndArgs;
          return this;
        }
        enableOrNameAndArgs = enableOrNameAndArgs ?? "help [command]";
        const [, helpName, helpArgs] = enableOrNameAndArgs.match(/([^ ]+) *(.*)/);
        const helpDescription = description ?? "display help for command";
        const helpCommand = this.createCommand(helpName);
        helpCommand.helpOption(false);
        if (helpArgs) helpCommand.arguments(helpArgs);
        if (helpDescription) helpCommand.description(helpDescription);
        this._addImplicitHelpCommand = true;
        this._helpCommand = helpCommand;
        return this;
      }
      /**
       * Add prepared custom help command.
       *
       * @param {(Command|string|boolean)} helpCommand - custom help command, or deprecated enableOrNameAndArgs as for `.helpCommand()`
       * @param {string} [deprecatedDescription] - deprecated custom description used with custom name only
       * @return {Command} `this` command for chaining
       */
      addHelpCommand(helpCommand, deprecatedDescription) {
        if (typeof helpCommand !== "object") {
          this.helpCommand(helpCommand, deprecatedDescription);
          return this;
        }
        this._addImplicitHelpCommand = true;
        this._helpCommand = helpCommand;
        return this;
      }
      /**
       * Lazy create help command.
       *
       * @return {(Command|null)}
       * @package
       */
      _getHelpCommand() {
        const hasImplicitHelpCommand = this._addImplicitHelpCommand ?? (this.commands.length && !this._actionHandler && !this._findCommand("help"));
        if (hasImplicitHelpCommand) {
          if (this._helpCommand === void 0) {
            this.helpCommand(void 0, void 0);
          }
          return this._helpCommand;
        }
        return null;
      }
      /**
       * Add hook for life cycle event.
       *
       * @param {string} event
       * @param {Function} listener
       * @return {Command} `this` command for chaining
       */
      hook(event, listener) {
        const allowedValues = ["preSubcommand", "preAction", "postAction"];
        if (!allowedValues.includes(event)) {
          throw new Error(`Unexpected value for event passed to hook : '${event}'.
Expecting one of '${allowedValues.join("', '")}'`);
        }
        if (this._lifeCycleHooks[event]) {
          this._lifeCycleHooks[event].push(listener);
        } else {
          this._lifeCycleHooks[event] = [listener];
        }
        return this;
      }
      /**
       * Register callback to use as replacement for calling process.exit.
       *
       * @param {Function} [fn] optional callback which will be passed a CommanderError, defaults to throwing
       * @return {Command} `this` command for chaining
       */
      exitOverride(fn) {
        if (fn) {
          this._exitCallback = fn;
        } else {
          this._exitCallback = (err) => {
            if (err.code !== "commander.executeSubCommandAsync") {
              throw err;
            } else {
            }
          };
        }
        return this;
      }
      /**
       * Call process.exit, and _exitCallback if defined.
       *
       * @param {number} exitCode exit code for using with process.exit
       * @param {string} code an id string representing the error
       * @param {string} message human-readable description of the error
       * @return never
       * @private
       */
      _exit(exitCode, code, message) {
        if (this._exitCallback) {
          this._exitCallback(new CommanderError2(exitCode, code, message));
        }
        process2.exit(exitCode);
      }
      /**
       * Register callback `fn` for the command.
       *
       * @example
       * program
       *   .command('serve')
       *   .description('start service')
       *   .action(function() {
       *      // do work here
       *   });
       *
       * @param {Function} fn
       * @return {Command} `this` command for chaining
       */
      action(fn) {
        const listener = (args) => {
          const expectedArgsCount = this.registeredArguments.length;
          const actionArgs = args.slice(0, expectedArgsCount);
          if (this._storeOptionsAsProperties) {
            actionArgs[expectedArgsCount] = this;
          } else {
            actionArgs[expectedArgsCount] = this.opts();
          }
          actionArgs.push(this);
          return fn.apply(this, actionArgs);
        };
        this._actionHandler = listener;
        return this;
      }
      /**
       * Factory routine to create a new unattached option.
       *
       * See .option() for creating an attached option, which uses this routine to
       * create the option. You can override createOption to return a custom option.
       *
       * @param {string} flags
       * @param {string} [description]
       * @return {Option} new option
       */
      createOption(flags, description) {
        return new Option2(flags, description);
      }
      /**
       * Wrap parseArgs to catch 'commander.invalidArgument'.
       *
       * @param {(Option | Argument)} target
       * @param {string} value
       * @param {*} previous
       * @param {string} invalidArgumentMessage
       * @private
       */
      _callParseArg(target, value, previous, invalidArgumentMessage) {
        try {
          return target.parseArg(value, previous);
        } catch (err) {
          if (err.code === "commander.invalidArgument") {
            const message = `${invalidArgumentMessage} ${err.message}`;
            this.error(message, { exitCode: err.exitCode, code: err.code });
          }
          throw err;
        }
      }
      /**
       * Check for option flag conflicts.
       * Register option if no conflicts found, or throw on conflict.
       *
       * @param {Option} option
       * @private
       */
      _registerOption(option) {
        const matchingOption = option.short && this._findOption(option.short) || option.long && this._findOption(option.long);
        if (matchingOption) {
          const matchingFlag = option.long && this._findOption(option.long) ? option.long : option.short;
          throw new Error(`Cannot add option '${option.flags}'${this._name && ` to command '${this._name}'`} due to conflicting flag '${matchingFlag}'
-  already used by option '${matchingOption.flags}'`);
        }
        this.options.push(option);
      }
      /**
       * Check for command name and alias conflicts with existing commands.
       * Register command if no conflicts found, or throw on conflict.
       *
       * @param {Command} command
       * @private
       */
      _registerCommand(command) {
        const knownBy = (cmd) => {
          return [cmd.name()].concat(cmd.aliases());
        };
        const alreadyUsed = knownBy(command).find(
          (name) => this._findCommand(name)
        );
        if (alreadyUsed) {
          const existingCmd = knownBy(this._findCommand(alreadyUsed)).join("|");
          const newCmd = knownBy(command).join("|");
          throw new Error(
            `cannot add command '${newCmd}' as already have command '${existingCmd}'`
          );
        }
        this.commands.push(command);
      }
      /**
       * Add an option.
       *
       * @param {Option} option
       * @return {Command} `this` command for chaining
       */
      addOption(option) {
        this._registerOption(option);
        const oname = option.name();
        const name = option.attributeName();
        if (option.negate) {
          const positiveLongFlag = option.long.replace(/^--no-/, "--");
          if (!this._findOption(positiveLongFlag)) {
            this.setOptionValueWithSource(
              name,
              option.defaultValue === void 0 ? true : option.defaultValue,
              "default"
            );
          }
        } else if (option.defaultValue !== void 0) {
          this.setOptionValueWithSource(name, option.defaultValue, "default");
        }
        const handleOptionValue = (val, invalidValueMessage, valueSource) => {
          if (val == null && option.presetArg !== void 0) {
            val = option.presetArg;
          }
          const oldValue = this.getOptionValue(name);
          if (val !== null && option.parseArg) {
            val = this._callParseArg(option, val, oldValue, invalidValueMessage);
          } else if (val !== null && option.variadic) {
            val = option._concatValue(val, oldValue);
          }
          if (val == null) {
            if (option.negate) {
              val = false;
            } else if (option.isBoolean() || option.optional) {
              val = true;
            } else {
              val = "";
            }
          }
          this.setOptionValueWithSource(name, val, valueSource);
        };
        this.on("option:" + oname, (val) => {
          const invalidValueMessage = `error: option '${option.flags}' argument '${val}' is invalid.`;
          handleOptionValue(val, invalidValueMessage, "cli");
        });
        if (option.envVar) {
          this.on("optionEnv:" + oname, (val) => {
            const invalidValueMessage = `error: option '${option.flags}' value '${val}' from env '${option.envVar}' is invalid.`;
            handleOptionValue(val, invalidValueMessage, "env");
          });
        }
        return this;
      }
      /**
       * Internal implementation shared by .option() and .requiredOption()
       *
       * @return {Command} `this` command for chaining
       * @private
       */
      _optionEx(config, flags, description, fn, defaultValue) {
        if (typeof flags === "object" && flags instanceof Option2) {
          throw new Error(
            "To add an Option object use addOption() instead of option() or requiredOption()"
          );
        }
        const option = this.createOption(flags, description);
        option.makeOptionMandatory(!!config.mandatory);
        if (typeof fn === "function") {
          option.default(defaultValue).argParser(fn);
        } else if (fn instanceof RegExp) {
          const regex = fn;
          fn = (val, def) => {
            const m2 = regex.exec(val);
            return m2 ? m2[0] : def;
          };
          option.default(defaultValue).argParser(fn);
        } else {
          option.default(fn);
        }
        return this.addOption(option);
      }
      /**
       * Define option with `flags`, `description`, and optional argument parsing function or `defaultValue` or both.
       *
       * The `flags` string contains the short and/or long flags, separated by comma, a pipe or space. A required
       * option-argument is indicated by `<>` and an optional option-argument by `[]`.
       *
       * See the README for more details, and see also addOption() and requiredOption().
       *
       * @example
       * program
       *     .option('-p, --pepper', 'add pepper')
       *     .option('-p, --pizza-type <TYPE>', 'type of pizza') // required option-argument
       *     .option('-c, --cheese [CHEESE]', 'add extra cheese', 'mozzarella') // optional option-argument with default
       *     .option('-t, --tip <VALUE>', 'add tip to purchase cost', parseFloat) // custom parse function
       *
       * @param {string} flags
       * @param {string} [description]
       * @param {(Function|*)} [parseArg] - custom option processing function or default value
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      option(flags, description, parseArg, defaultValue) {
        return this._optionEx({}, flags, description, parseArg, defaultValue);
      }
      /**
       * Add a required option which must have a value after parsing. This usually means
       * the option must be specified on the command line. (Otherwise the same as .option().)
       *
       * The `flags` string contains the short and/or long flags, separated by comma, a pipe or space.
       *
       * @param {string} flags
       * @param {string} [description]
       * @param {(Function|*)} [parseArg] - custom option processing function or default value
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      requiredOption(flags, description, parseArg, defaultValue) {
        return this._optionEx(
          { mandatory: true },
          flags,
          description,
          parseArg,
          defaultValue
        );
      }
      /**
       * Alter parsing of short flags with optional values.
       *
       * @example
       * // for `.option('-f,--flag [value]'):
       * program.combineFlagAndOptionalValue(true);  // `-f80` is treated like `--flag=80`, this is the default behaviour
       * program.combineFlagAndOptionalValue(false) // `-fb` is treated like `-f -b`
       *
       * @param {boolean} [combine] - if `true` or omitted, an optional value can be specified directly after the flag.
       * @return {Command} `this` command for chaining
       */
      combineFlagAndOptionalValue(combine = true) {
        this._combineFlagAndOptionalValue = !!combine;
        return this;
      }
      /**
       * Allow unknown options on the command line.
       *
       * @param {boolean} [allowUnknown] - if `true` or omitted, no error will be thrown for unknown options.
       * @return {Command} `this` command for chaining
       */
      allowUnknownOption(allowUnknown = true) {
        this._allowUnknownOption = !!allowUnknown;
        return this;
      }
      /**
       * Allow excess command-arguments on the command line. Pass false to make excess arguments an error.
       *
       * @param {boolean} [allowExcess] - if `true` or omitted, no error will be thrown for excess arguments.
       * @return {Command} `this` command for chaining
       */
      allowExcessArguments(allowExcess = true) {
        this._allowExcessArguments = !!allowExcess;
        return this;
      }
      /**
       * Enable positional options. Positional means global options are specified before subcommands which lets
       * subcommands reuse the same option names, and also enables subcommands to turn on passThroughOptions.
       * The default behaviour is non-positional and global options may appear anywhere on the command line.
       *
       * @param {boolean} [positional]
       * @return {Command} `this` command for chaining
       */
      enablePositionalOptions(positional = true) {
        this._enablePositionalOptions = !!positional;
        return this;
      }
      /**
       * Pass through options that come after command-arguments rather than treat them as command-options,
       * so actual command-options come before command-arguments. Turning this on for a subcommand requires
       * positional options to have been enabled on the program (parent commands).
       * The default behaviour is non-positional and options may appear before or after command-arguments.
       *
       * @param {boolean} [passThrough] for unknown options.
       * @return {Command} `this` command for chaining
       */
      passThroughOptions(passThrough = true) {
        this._passThroughOptions = !!passThrough;
        this._checkForBrokenPassThrough();
        return this;
      }
      /**
       * @private
       */
      _checkForBrokenPassThrough() {
        if (this.parent && this._passThroughOptions && !this.parent._enablePositionalOptions) {
          throw new Error(
            `passThroughOptions cannot be used for '${this._name}' without turning on enablePositionalOptions for parent command(s)`
          );
        }
      }
      /**
       * Whether to store option values as properties on command object,
       * or store separately (specify false). In both cases the option values can be accessed using .opts().
       *
       * @param {boolean} [storeAsProperties=true]
       * @return {Command} `this` command for chaining
       */
      storeOptionsAsProperties(storeAsProperties = true) {
        if (this.options.length) {
          throw new Error("call .storeOptionsAsProperties() before adding options");
        }
        if (Object.keys(this._optionValues).length) {
          throw new Error(
            "call .storeOptionsAsProperties() before setting option values"
          );
        }
        this._storeOptionsAsProperties = !!storeAsProperties;
        return this;
      }
      /**
       * Retrieve option value.
       *
       * @param {string} key
       * @return {object} value
       */
      getOptionValue(key) {
        if (this._storeOptionsAsProperties) {
          return this[key];
        }
        return this._optionValues[key];
      }
      /**
       * Store option value.
       *
       * @param {string} key
       * @param {object} value
       * @return {Command} `this` command for chaining
       */
      setOptionValue(key, value) {
        return this.setOptionValueWithSource(key, value, void 0);
      }
      /**
       * Store option value and where the value came from.
       *
       * @param {string} key
       * @param {object} value
       * @param {string} source - expected values are default/config/env/cli/implied
       * @return {Command} `this` command for chaining
       */
      setOptionValueWithSource(key, value, source) {
        if (this._storeOptionsAsProperties) {
          this[key] = value;
        } else {
          this._optionValues[key] = value;
        }
        this._optionValueSources[key] = source;
        return this;
      }
      /**
       * Get source of option value.
       * Expected values are default | config | env | cli | implied
       *
       * @param {string} key
       * @return {string}
       */
      getOptionValueSource(key) {
        return this._optionValueSources[key];
      }
      /**
       * Get source of option value. See also .optsWithGlobals().
       * Expected values are default | config | env | cli | implied
       *
       * @param {string} key
       * @return {string}
       */
      getOptionValueSourceWithGlobals(key) {
        let source;
        this._getCommandAndAncestors().forEach((cmd) => {
          if (cmd.getOptionValueSource(key) !== void 0) {
            source = cmd.getOptionValueSource(key);
          }
        });
        return source;
      }
      /**
       * Get user arguments from implied or explicit arguments.
       * Side-effects: set _scriptPath if args included script. Used for default program name, and subcommand searches.
       *
       * @private
       */
      _prepareUserArgs(argv, parseOptions) {
        if (argv !== void 0 && !Array.isArray(argv)) {
          throw new Error("first parameter to parse must be array or undefined");
        }
        parseOptions = parseOptions || {};
        if (argv === void 0 && parseOptions.from === void 0) {
          if (process2.versions?.electron) {
            parseOptions.from = "electron";
          }
          const execArgv = process2.execArgv ?? [];
          if (execArgv.includes("-e") || execArgv.includes("--eval") || execArgv.includes("-p") || execArgv.includes("--print")) {
            parseOptions.from = "eval";
          }
        }
        if (argv === void 0) {
          argv = process2.argv;
        }
        this.rawArgs = argv.slice();
        let userArgs;
        switch (parseOptions.from) {
          case void 0:
          case "node":
            this._scriptPath = argv[1];
            userArgs = argv.slice(2);
            break;
          case "electron":
            if (process2.defaultApp) {
              this._scriptPath = argv[1];
              userArgs = argv.slice(2);
            } else {
              userArgs = argv.slice(1);
            }
            break;
          case "user":
            userArgs = argv.slice(0);
            break;
          case "eval":
            userArgs = argv.slice(1);
            break;
          default:
            throw new Error(
              `unexpected parse option { from: '${parseOptions.from}' }`
            );
        }
        if (!this._name && this._scriptPath)
          this.nameFromFilename(this._scriptPath);
        this._name = this._name || "program";
        return userArgs;
      }
      /**
       * Parse `argv`, setting options and invoking commands when defined.
       *
       * Use parseAsync instead of parse if any of your action handlers are async.
       *
       * Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
       *
       * Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
       * - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
       * - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
       * - `'user'`: just user arguments
       *
       * @example
       * program.parse(); // parse process.argv and auto-detect electron and special node flags
       * program.parse(process.argv); // assume argv[0] is app and argv[1] is script
       * program.parse(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
       *
       * @param {string[]} [argv] - optional, defaults to process.argv
       * @param {object} [parseOptions] - optionally specify style of options with from: node/user/electron
       * @param {string} [parseOptions.from] - where the args are from: 'node', 'user', 'electron'
       * @return {Command} `this` command for chaining
       */
      parse(argv, parseOptions) {
        const userArgs = this._prepareUserArgs(argv, parseOptions);
        this._parseCommand([], userArgs);
        return this;
      }
      /**
       * Parse `argv`, setting options and invoking commands when defined.
       *
       * Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
       *
       * Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
       * - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
       * - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
       * - `'user'`: just user arguments
       *
       * @example
       * await program.parseAsync(); // parse process.argv and auto-detect electron and special node flags
       * await program.parseAsync(process.argv); // assume argv[0] is app and argv[1] is script
       * await program.parseAsync(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
       *
       * @param {string[]} [argv]
       * @param {object} [parseOptions]
       * @param {string} parseOptions.from - where the args are from: 'node', 'user', 'electron'
       * @return {Promise}
       */
      async parseAsync(argv, parseOptions) {
        const userArgs = this._prepareUserArgs(argv, parseOptions);
        await this._parseCommand([], userArgs);
        return this;
      }
      /**
       * Execute a sub-command executable.
       *
       * @private
       */
      _executeSubCommand(subcommand, args) {
        args = args.slice();
        let launchWithNode = false;
        const sourceExt = [".js", ".ts", ".tsx", ".mjs", ".cjs"];
        function findFile(baseDir, baseName) {
          const localBin = path7.resolve(baseDir, baseName);
          if (fs7.existsSync(localBin)) return localBin;
          if (sourceExt.includes(path7.extname(baseName))) return void 0;
          const foundExt = sourceExt.find(
            (ext) => fs7.existsSync(`${localBin}${ext}`)
          );
          if (foundExt) return `${localBin}${foundExt}`;
          return void 0;
        }
        this._checkForMissingMandatoryOptions();
        this._checkForConflictingOptions();
        let executableFile = subcommand._executableFile || `${this._name}-${subcommand._name}`;
        let executableDir = this._executableDir || "";
        if (this._scriptPath) {
          let resolvedScriptPath;
          try {
            resolvedScriptPath = fs7.realpathSync(this._scriptPath);
          } catch (err) {
            resolvedScriptPath = this._scriptPath;
          }
          executableDir = path7.resolve(
            path7.dirname(resolvedScriptPath),
            executableDir
          );
        }
        if (executableDir) {
          let localFile = findFile(executableDir, executableFile);
          if (!localFile && !subcommand._executableFile && this._scriptPath) {
            const legacyName = path7.basename(
              this._scriptPath,
              path7.extname(this._scriptPath)
            );
            if (legacyName !== this._name) {
              localFile = findFile(
                executableDir,
                `${legacyName}-${subcommand._name}`
              );
            }
          }
          executableFile = localFile || executableFile;
        }
        launchWithNode = sourceExt.includes(path7.extname(executableFile));
        let proc;
        if (process2.platform !== "win32") {
          if (launchWithNode) {
            args.unshift(executableFile);
            args = incrementNodeInspectorPort(process2.execArgv).concat(args);
            proc = childProcess.spawn(process2.argv[0], args, { stdio: "inherit" });
          } else {
            proc = childProcess.spawn(executableFile, args, { stdio: "inherit" });
          }
        } else {
          args.unshift(executableFile);
          args = incrementNodeInspectorPort(process2.execArgv).concat(args);
          proc = childProcess.spawn(process2.execPath, args, { stdio: "inherit" });
        }
        if (!proc.killed) {
          const signals = ["SIGUSR1", "SIGUSR2", "SIGTERM", "SIGINT", "SIGHUP"];
          signals.forEach((signal) => {
            process2.on(signal, () => {
              if (proc.killed === false && proc.exitCode === null) {
                proc.kill(signal);
              }
            });
          });
        }
        const exitCallback = this._exitCallback;
        proc.on("close", (code) => {
          code = code ?? 1;
          if (!exitCallback) {
            process2.exit(code);
          } else {
            exitCallback(
              new CommanderError2(
                code,
                "commander.executeSubCommandAsync",
                "(close)"
              )
            );
          }
        });
        proc.on("error", (err) => {
          if (err.code === "ENOENT") {
            const executableDirMessage = executableDir ? `searched for local subcommand relative to directory '${executableDir}'` : "no directory for search for local subcommand, use .executableDir() to supply a custom directory";
            const executableMissing = `'${executableFile}' does not exist
 - if '${subcommand._name}' is not meant to be an executable command, remove description parameter from '.command()' and use '.description()' instead
 - if the default executable name is not suitable, use the executableFile option to supply a custom name or path
 - ${executableDirMessage}`;
            throw new Error(executableMissing);
          } else if (err.code === "EACCES") {
            throw new Error(`'${executableFile}' not executable`);
          }
          if (!exitCallback) {
            process2.exit(1);
          } else {
            const wrappedError = new CommanderError2(
              1,
              "commander.executeSubCommandAsync",
              "(error)"
            );
            wrappedError.nestedError = err;
            exitCallback(wrappedError);
          }
        });
        this.runningCommand = proc;
      }
      /**
       * @private
       */
      _dispatchSubcommand(commandName, operands, unknown) {
        const subCommand = this._findCommand(commandName);
        if (!subCommand) this.help({ error: true });
        let promiseChain;
        promiseChain = this._chainOrCallSubCommandHook(
          promiseChain,
          subCommand,
          "preSubcommand"
        );
        promiseChain = this._chainOrCall(promiseChain, () => {
          if (subCommand._executableHandler) {
            this._executeSubCommand(subCommand, operands.concat(unknown));
          } else {
            return subCommand._parseCommand(operands, unknown);
          }
        });
        return promiseChain;
      }
      /**
       * Invoke help directly if possible, or dispatch if necessary.
       * e.g. help foo
       *
       * @private
       */
      _dispatchHelpCommand(subcommandName) {
        if (!subcommandName) {
          this.help();
        }
        const subCommand = this._findCommand(subcommandName);
        if (subCommand && !subCommand._executableHandler) {
          subCommand.help();
        }
        return this._dispatchSubcommand(
          subcommandName,
          [],
          [this._getHelpOption()?.long ?? this._getHelpOption()?.short ?? "--help"]
        );
      }
      /**
       * Check this.args against expected this.registeredArguments.
       *
       * @private
       */
      _checkNumberOfArguments() {
        this.registeredArguments.forEach((arg, i) => {
          if (arg.required && this.args[i] == null) {
            this.missingArgument(arg.name());
          }
        });
        if (this.registeredArguments.length > 0 && this.registeredArguments[this.registeredArguments.length - 1].variadic) {
          return;
        }
        if (this.args.length > this.registeredArguments.length) {
          this._excessArguments(this.args);
        }
      }
      /**
       * Process this.args using this.registeredArguments and save as this.processedArgs!
       *
       * @private
       */
      _processArguments() {
        const myParseArg = (argument, value, previous) => {
          let parsedValue = value;
          if (value !== null && argument.parseArg) {
            const invalidValueMessage = `error: command-argument value '${value}' is invalid for argument '${argument.name()}'.`;
            parsedValue = this._callParseArg(
              argument,
              value,
              previous,
              invalidValueMessage
            );
          }
          return parsedValue;
        };
        this._checkNumberOfArguments();
        const processedArgs = [];
        this.registeredArguments.forEach((declaredArg, index) => {
          let value = declaredArg.defaultValue;
          if (declaredArg.variadic) {
            if (index < this.args.length) {
              value = this.args.slice(index);
              if (declaredArg.parseArg) {
                value = value.reduce((processed, v3) => {
                  return myParseArg(declaredArg, v3, processed);
                }, declaredArg.defaultValue);
              }
            } else if (value === void 0) {
              value = [];
            }
          } else if (index < this.args.length) {
            value = this.args[index];
            if (declaredArg.parseArg) {
              value = myParseArg(declaredArg, value, declaredArg.defaultValue);
            }
          }
          processedArgs[index] = value;
        });
        this.processedArgs = processedArgs;
      }
      /**
       * Once we have a promise we chain, but call synchronously until then.
       *
       * @param {(Promise|undefined)} promise
       * @param {Function} fn
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCall(promise, fn) {
        if (promise && promise.then && typeof promise.then === "function") {
          return promise.then(() => fn());
        }
        return fn();
      }
      /**
       *
       * @param {(Promise|undefined)} promise
       * @param {string} event
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCallHooks(promise, event) {
        let result = promise;
        const hooks = [];
        this._getCommandAndAncestors().reverse().filter((cmd) => cmd._lifeCycleHooks[event] !== void 0).forEach((hookedCommand) => {
          hookedCommand._lifeCycleHooks[event].forEach((callback) => {
            hooks.push({ hookedCommand, callback });
          });
        });
        if (event === "postAction") {
          hooks.reverse();
        }
        hooks.forEach((hookDetail) => {
          result = this._chainOrCall(result, () => {
            return hookDetail.callback(hookDetail.hookedCommand, this);
          });
        });
        return result;
      }
      /**
       *
       * @param {(Promise|undefined)} promise
       * @param {Command} subCommand
       * @param {string} event
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCallSubCommandHook(promise, subCommand, event) {
        let result = promise;
        if (this._lifeCycleHooks[event] !== void 0) {
          this._lifeCycleHooks[event].forEach((hook) => {
            result = this._chainOrCall(result, () => {
              return hook(this, subCommand);
            });
          });
        }
        return result;
      }
      /**
       * Process arguments in context of this command.
       * Returns action result, in case it is a promise.
       *
       * @private
       */
      _parseCommand(operands, unknown) {
        const parsed = this.parseOptions(unknown);
        this._parseOptionsEnv();
        this._parseOptionsImplied();
        operands = operands.concat(parsed.operands);
        unknown = parsed.unknown;
        this.args = operands.concat(unknown);
        if (operands && this._findCommand(operands[0])) {
          return this._dispatchSubcommand(operands[0], operands.slice(1), unknown);
        }
        if (this._getHelpCommand() && operands[0] === this._getHelpCommand().name()) {
          return this._dispatchHelpCommand(operands[1]);
        }
        if (this._defaultCommandName) {
          this._outputHelpIfRequested(unknown);
          return this._dispatchSubcommand(
            this._defaultCommandName,
            operands,
            unknown
          );
        }
        if (this.commands.length && this.args.length === 0 && !this._actionHandler && !this._defaultCommandName) {
          this.help({ error: true });
        }
        this._outputHelpIfRequested(parsed.unknown);
        this._checkForMissingMandatoryOptions();
        this._checkForConflictingOptions();
        const checkForUnknownOptions = () => {
          if (parsed.unknown.length > 0) {
            this.unknownOption(parsed.unknown[0]);
          }
        };
        const commandEvent = `command:${this.name()}`;
        if (this._actionHandler) {
          checkForUnknownOptions();
          this._processArguments();
          let promiseChain;
          promiseChain = this._chainOrCallHooks(promiseChain, "preAction");
          promiseChain = this._chainOrCall(
            promiseChain,
            () => this._actionHandler(this.processedArgs)
          );
          if (this.parent) {
            promiseChain = this._chainOrCall(promiseChain, () => {
              this.parent.emit(commandEvent, operands, unknown);
            });
          }
          promiseChain = this._chainOrCallHooks(promiseChain, "postAction");
          return promiseChain;
        }
        if (this.parent && this.parent.listenerCount(commandEvent)) {
          checkForUnknownOptions();
          this._processArguments();
          this.parent.emit(commandEvent, operands, unknown);
        } else if (operands.length) {
          if (this._findCommand("*")) {
            return this._dispatchSubcommand("*", operands, unknown);
          }
          if (this.listenerCount("command:*")) {
            this.emit("command:*", operands, unknown);
          } else if (this.commands.length) {
            this.unknownCommand();
          } else {
            checkForUnknownOptions();
            this._processArguments();
          }
        } else if (this.commands.length) {
          checkForUnknownOptions();
          this.help({ error: true });
        } else {
          checkForUnknownOptions();
          this._processArguments();
        }
      }
      /**
       * Find matching command.
       *
       * @private
       * @return {Command | undefined}
       */
      _findCommand(name) {
        if (!name) return void 0;
        return this.commands.find(
          (cmd) => cmd._name === name || cmd._aliases.includes(name)
        );
      }
      /**
       * Return an option matching `arg` if any.
       *
       * @param {string} arg
       * @return {Option}
       * @package
       */
      _findOption(arg) {
        return this.options.find((option) => option.is(arg));
      }
      /**
       * Display an error message if a mandatory option does not have a value.
       * Called after checking for help flags in leaf subcommand.
       *
       * @private
       */
      _checkForMissingMandatoryOptions() {
        this._getCommandAndAncestors().forEach((cmd) => {
          cmd.options.forEach((anOption) => {
            if (anOption.mandatory && cmd.getOptionValue(anOption.attributeName()) === void 0) {
              cmd.missingMandatoryOptionValue(anOption);
            }
          });
        });
      }
      /**
       * Display an error message if conflicting options are used together in this.
       *
       * @private
       */
      _checkForConflictingLocalOptions() {
        const definedNonDefaultOptions = this.options.filter((option) => {
          const optionKey = option.attributeName();
          if (this.getOptionValue(optionKey) === void 0) {
            return false;
          }
          return this.getOptionValueSource(optionKey) !== "default";
        });
        const optionsWithConflicting = definedNonDefaultOptions.filter(
          (option) => option.conflictsWith.length > 0
        );
        optionsWithConflicting.forEach((option) => {
          const conflictingAndDefined = definedNonDefaultOptions.find(
            (defined) => option.conflictsWith.includes(defined.attributeName())
          );
          if (conflictingAndDefined) {
            this._conflictingOption(option, conflictingAndDefined);
          }
        });
      }
      /**
       * Display an error message if conflicting options are used together.
       * Called after checking for help flags in leaf subcommand.
       *
       * @private
       */
      _checkForConflictingOptions() {
        this._getCommandAndAncestors().forEach((cmd) => {
          cmd._checkForConflictingLocalOptions();
        });
      }
      /**
       * Parse options from `argv` removing known options,
       * and return argv split into operands and unknown arguments.
       *
       * Examples:
       *
       *     argv => operands, unknown
       *     --known kkk op => [op], []
       *     op --known kkk => [op], []
       *     sub --unknown uuu op => [sub], [--unknown uuu op]
       *     sub -- --unknown uuu op => [sub --unknown uuu op], []
       *
       * @param {string[]} argv
       * @return {{operands: string[], unknown: string[]}}
       */
      parseOptions(argv) {
        const operands = [];
        const unknown = [];
        let dest = operands;
        const args = argv.slice();
        function maybeOption(arg) {
          return arg.length > 1 && arg[0] === "-";
        }
        let activeVariadicOption = null;
        while (args.length) {
          const arg = args.shift();
          if (arg === "--") {
            if (dest === unknown) dest.push(arg);
            dest.push(...args);
            break;
          }
          if (activeVariadicOption && !maybeOption(arg)) {
            this.emit(`option:${activeVariadicOption.name()}`, arg);
            continue;
          }
          activeVariadicOption = null;
          if (maybeOption(arg)) {
            const option = this._findOption(arg);
            if (option) {
              if (option.required) {
                const value = args.shift();
                if (value === void 0) this.optionMissingArgument(option);
                this.emit(`option:${option.name()}`, value);
              } else if (option.optional) {
                let value = null;
                if (args.length > 0 && !maybeOption(args[0])) {
                  value = args.shift();
                }
                this.emit(`option:${option.name()}`, value);
              } else {
                this.emit(`option:${option.name()}`);
              }
              activeVariadicOption = option.variadic ? option : null;
              continue;
            }
          }
          if (arg.length > 2 && arg[0] === "-" && arg[1] !== "-") {
            const option = this._findOption(`-${arg[1]}`);
            if (option) {
              if (option.required || option.optional && this._combineFlagAndOptionalValue) {
                this.emit(`option:${option.name()}`, arg.slice(2));
              } else {
                this.emit(`option:${option.name()}`);
                args.unshift(`-${arg.slice(2)}`);
              }
              continue;
            }
          }
          if (/^--[^=]+=/.test(arg)) {
            const index = arg.indexOf("=");
            const option = this._findOption(arg.slice(0, index));
            if (option && (option.required || option.optional)) {
              this.emit(`option:${option.name()}`, arg.slice(index + 1));
              continue;
            }
          }
          if (maybeOption(arg)) {
            dest = unknown;
          }
          if ((this._enablePositionalOptions || this._passThroughOptions) && operands.length === 0 && unknown.length === 0) {
            if (this._findCommand(arg)) {
              operands.push(arg);
              if (args.length > 0) unknown.push(...args);
              break;
            } else if (this._getHelpCommand() && arg === this._getHelpCommand().name()) {
              operands.push(arg);
              if (args.length > 0) operands.push(...args);
              break;
            } else if (this._defaultCommandName) {
              unknown.push(arg);
              if (args.length > 0) unknown.push(...args);
              break;
            }
          }
          if (this._passThroughOptions) {
            dest.push(arg);
            if (args.length > 0) dest.push(...args);
            break;
          }
          dest.push(arg);
        }
        return { operands, unknown };
      }
      /**
       * Return an object containing local option values as key-value pairs.
       *
       * @return {object}
       */
      opts() {
        if (this._storeOptionsAsProperties) {
          const result = {};
          const len = this.options.length;
          for (let i = 0; i < len; i++) {
            const key = this.options[i].attributeName();
            result[key] = key === this._versionOptionName ? this._version : this[key];
          }
          return result;
        }
        return this._optionValues;
      }
      /**
       * Return an object containing merged local and global option values as key-value pairs.
       *
       * @return {object}
       */
      optsWithGlobals() {
        return this._getCommandAndAncestors().reduce(
          (combinedOptions, cmd) => Object.assign(combinedOptions, cmd.opts()),
          {}
        );
      }
      /**
       * Display error message and exit (or call exitOverride).
       *
       * @param {string} message
       * @param {object} [errorOptions]
       * @param {string} [errorOptions.code] - an id string representing the error
       * @param {number} [errorOptions.exitCode] - used with process.exit
       */
      error(message, errorOptions) {
        this._outputConfiguration.outputError(
          `${message}
`,
          this._outputConfiguration.writeErr
        );
        if (typeof this._showHelpAfterError === "string") {
          this._outputConfiguration.writeErr(`${this._showHelpAfterError}
`);
        } else if (this._showHelpAfterError) {
          this._outputConfiguration.writeErr("\n");
          this.outputHelp({ error: true });
        }
        const config = errorOptions || {};
        const exitCode = config.exitCode || 1;
        const code = config.code || "commander.error";
        this._exit(exitCode, code, message);
      }
      /**
       * Apply any option related environment variables, if option does
       * not have a value from cli or client code.
       *
       * @private
       */
      _parseOptionsEnv() {
        this.options.forEach((option) => {
          if (option.envVar && option.envVar in process2.env) {
            const optionKey = option.attributeName();
            if (this.getOptionValue(optionKey) === void 0 || ["default", "config", "env"].includes(
              this.getOptionValueSource(optionKey)
            )) {
              if (option.required || option.optional) {
                this.emit(`optionEnv:${option.name()}`, process2.env[option.envVar]);
              } else {
                this.emit(`optionEnv:${option.name()}`);
              }
            }
          }
        });
      }
      /**
       * Apply any implied option values, if option is undefined or default value.
       *
       * @private
       */
      _parseOptionsImplied() {
        const dualHelper = new DualOptions(this.options);
        const hasCustomOptionValue = (optionKey) => {
          return this.getOptionValue(optionKey) !== void 0 && !["default", "implied"].includes(this.getOptionValueSource(optionKey));
        };
        this.options.filter(
          (option) => option.implied !== void 0 && hasCustomOptionValue(option.attributeName()) && dualHelper.valueFromOption(
            this.getOptionValue(option.attributeName()),
            option
          )
        ).forEach((option) => {
          Object.keys(option.implied).filter((impliedKey) => !hasCustomOptionValue(impliedKey)).forEach((impliedKey) => {
            this.setOptionValueWithSource(
              impliedKey,
              option.implied[impliedKey],
              "implied"
            );
          });
        });
      }
      /**
       * Argument `name` is missing.
       *
       * @param {string} name
       * @private
       */
      missingArgument(name) {
        const message = `error: missing required argument '${name}'`;
        this.error(message, { code: "commander.missingArgument" });
      }
      /**
       * `Option` is missing an argument.
       *
       * @param {Option} option
       * @private
       */
      optionMissingArgument(option) {
        const message = `error: option '${option.flags}' argument missing`;
        this.error(message, { code: "commander.optionMissingArgument" });
      }
      /**
       * `Option` does not have a value, and is a mandatory option.
       *
       * @param {Option} option
       * @private
       */
      missingMandatoryOptionValue(option) {
        const message = `error: required option '${option.flags}' not specified`;
        this.error(message, { code: "commander.missingMandatoryOptionValue" });
      }
      /**
       * `Option` conflicts with another option.
       *
       * @param {Option} option
       * @param {Option} conflictingOption
       * @private
       */
      _conflictingOption(option, conflictingOption) {
        const findBestOptionFromValue = (option2) => {
          const optionKey = option2.attributeName();
          const optionValue = this.getOptionValue(optionKey);
          const negativeOption = this.options.find(
            (target) => target.negate && optionKey === target.attributeName()
          );
          const positiveOption = this.options.find(
            (target) => !target.negate && optionKey === target.attributeName()
          );
          if (negativeOption && (negativeOption.presetArg === void 0 && optionValue === false || negativeOption.presetArg !== void 0 && optionValue === negativeOption.presetArg)) {
            return negativeOption;
          }
          return positiveOption || option2;
        };
        const getErrorMessage = (option2) => {
          const bestOption = findBestOptionFromValue(option2);
          const optionKey = bestOption.attributeName();
          const source = this.getOptionValueSource(optionKey);
          if (source === "env") {
            return `environment variable '${bestOption.envVar}'`;
          }
          return `option '${bestOption.flags}'`;
        };
        const message = `error: ${getErrorMessage(option)} cannot be used with ${getErrorMessage(conflictingOption)}`;
        this.error(message, { code: "commander.conflictingOption" });
      }
      /**
       * Unknown option `flag`.
       *
       * @param {string} flag
       * @private
       */
      unknownOption(flag) {
        if (this._allowUnknownOption) return;
        let suggestion = "";
        if (flag.startsWith("--") && this._showSuggestionAfterError) {
          let candidateFlags = [];
          let command = this;
          do {
            const moreFlags = command.createHelp().visibleOptions(command).filter((option) => option.long).map((option) => option.long);
            candidateFlags = candidateFlags.concat(moreFlags);
            command = command.parent;
          } while (command && !command._enablePositionalOptions);
          suggestion = suggestSimilar(flag, candidateFlags);
        }
        const message = `error: unknown option '${flag}'${suggestion}`;
        this.error(message, { code: "commander.unknownOption" });
      }
      /**
       * Excess arguments, more than expected.
       *
       * @param {string[]} receivedArgs
       * @private
       */
      _excessArguments(receivedArgs) {
        if (this._allowExcessArguments) return;
        const expected = this.registeredArguments.length;
        const s = expected === 1 ? "" : "s";
        const forSubcommand = this.parent ? ` for '${this.name()}'` : "";
        const message = `error: too many arguments${forSubcommand}. Expected ${expected} argument${s} but got ${receivedArgs.length}.`;
        this.error(message, { code: "commander.excessArguments" });
      }
      /**
       * Unknown command.
       *
       * @private
       */
      unknownCommand() {
        const unknownName = this.args[0];
        let suggestion = "";
        if (this._showSuggestionAfterError) {
          const candidateNames = [];
          this.createHelp().visibleCommands(this).forEach((command) => {
            candidateNames.push(command.name());
            if (command.alias()) candidateNames.push(command.alias());
          });
          suggestion = suggestSimilar(unknownName, candidateNames);
        }
        const message = `error: unknown command '${unknownName}'${suggestion}`;
        this.error(message, { code: "commander.unknownCommand" });
      }
      /**
       * Get or set the program version.
       *
       * This method auto-registers the "-V, --version" option which will print the version number.
       *
       * You can optionally supply the flags and description to override the defaults.
       *
       * @param {string} [str]
       * @param {string} [flags]
       * @param {string} [description]
       * @return {(this | string | undefined)} `this` command for chaining, or version string if no arguments
       */
      version(str, flags, description) {
        if (str === void 0) return this._version;
        this._version = str;
        flags = flags || "-V, --version";
        description = description || "output the version number";
        const versionOption = this.createOption(flags, description);
        this._versionOptionName = versionOption.attributeName();
        this._registerOption(versionOption);
        this.on("option:" + versionOption.name(), () => {
          this._outputConfiguration.writeOut(`${str}
`);
          this._exit(0, "commander.version", str);
        });
        return this;
      }
      /**
       * Set the description.
       *
       * @param {string} [str]
       * @param {object} [argsDescription]
       * @return {(string|Command)}
       */
      description(str, argsDescription) {
        if (str === void 0 && argsDescription === void 0)
          return this._description;
        this._description = str;
        if (argsDescription) {
          this._argsDescription = argsDescription;
        }
        return this;
      }
      /**
       * Set the summary. Used when listed as subcommand of parent.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      summary(str) {
        if (str === void 0) return this._summary;
        this._summary = str;
        return this;
      }
      /**
       * Set an alias for the command.
       *
       * You may call more than once to add multiple aliases. Only the first alias is shown in the auto-generated help.
       *
       * @param {string} [alias]
       * @return {(string|Command)}
       */
      alias(alias) {
        if (alias === void 0) return this._aliases[0];
        let command = this;
        if (this.commands.length !== 0 && this.commands[this.commands.length - 1]._executableHandler) {
          command = this.commands[this.commands.length - 1];
        }
        if (alias === command._name)
          throw new Error("Command alias can't be the same as its name");
        const matchingCommand = this.parent?._findCommand(alias);
        if (matchingCommand) {
          const existingCmd = [matchingCommand.name()].concat(matchingCommand.aliases()).join("|");
          throw new Error(
            `cannot add alias '${alias}' to command '${this.name()}' as already have command '${existingCmd}'`
          );
        }
        command._aliases.push(alias);
        return this;
      }
      /**
       * Set aliases for the command.
       *
       * Only the first alias is shown in the auto-generated help.
       *
       * @param {string[]} [aliases]
       * @return {(string[]|Command)}
       */
      aliases(aliases) {
        if (aliases === void 0) return this._aliases;
        aliases.forEach((alias) => this.alias(alias));
        return this;
      }
      /**
       * Set / get the command usage `str`.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      usage(str) {
        if (str === void 0) {
          if (this._usage) return this._usage;
          const args = this.registeredArguments.map((arg) => {
            return humanReadableArgName(arg);
          });
          return [].concat(
            this.options.length || this._helpOption !== null ? "[options]" : [],
            this.commands.length ? "[command]" : [],
            this.registeredArguments.length ? args : []
          ).join(" ");
        }
        this._usage = str;
        return this;
      }
      /**
       * Get or set the name of the command.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      name(str) {
        if (str === void 0) return this._name;
        this._name = str;
        return this;
      }
      /**
       * Set the name of the command from script filename, such as process.argv[1],
       * or require.main.filename, or __filename.
       *
       * (Used internally and public although not documented in README.)
       *
       * @example
       * program.nameFromFilename(require.main.filename);
       *
       * @param {string} filename
       * @return {Command}
       */
      nameFromFilename(filename) {
        this._name = path7.basename(filename, path7.extname(filename));
        return this;
      }
      /**
       * Get or set the directory for searching for executable subcommands of this command.
       *
       * @example
       * program.executableDir(__dirname);
       * // or
       * program.executableDir('subcommands');
       *
       * @param {string} [path]
       * @return {(string|null|Command)}
       */
      executableDir(path8) {
        if (path8 === void 0) return this._executableDir;
        this._executableDir = path8;
        return this;
      }
      /**
       * Return program help documentation.
       *
       * @param {{ error: boolean }} [contextOptions] - pass {error:true} to wrap for stderr instead of stdout
       * @return {string}
       */
      helpInformation(contextOptions) {
        const helper = this.createHelp();
        if (helper.helpWidth === void 0) {
          helper.helpWidth = contextOptions && contextOptions.error ? this._outputConfiguration.getErrHelpWidth() : this._outputConfiguration.getOutHelpWidth();
        }
        return helper.formatHelp(this, helper);
      }
      /**
       * @private
       */
      _getHelpContext(contextOptions) {
        contextOptions = contextOptions || {};
        const context = { error: !!contextOptions.error };
        let write;
        if (context.error) {
          write = (arg) => this._outputConfiguration.writeErr(arg);
        } else {
          write = (arg) => this._outputConfiguration.writeOut(arg);
        }
        context.write = contextOptions.write || write;
        context.command = this;
        return context;
      }
      /**
       * Output help information for this command.
       *
       * Outputs built-in help, and custom text added using `.addHelpText()`.
       *
       * @param {{ error: boolean } | Function} [contextOptions] - pass {error:true} to write to stderr instead of stdout
       */
      outputHelp(contextOptions) {
        let deprecatedCallback;
        if (typeof contextOptions === "function") {
          deprecatedCallback = contextOptions;
          contextOptions = void 0;
        }
        const context = this._getHelpContext(contextOptions);
        this._getCommandAndAncestors().reverse().forEach((command) => command.emit("beforeAllHelp", context));
        this.emit("beforeHelp", context);
        let helpInformation = this.helpInformation(context);
        if (deprecatedCallback) {
          helpInformation = deprecatedCallback(helpInformation);
          if (typeof helpInformation !== "string" && !Buffer.isBuffer(helpInformation)) {
            throw new Error("outputHelp callback must return a string or a Buffer");
          }
        }
        context.write(helpInformation);
        if (this._getHelpOption()?.long) {
          this.emit(this._getHelpOption().long);
        }
        this.emit("afterHelp", context);
        this._getCommandAndAncestors().forEach(
          (command) => command.emit("afterAllHelp", context)
        );
      }
      /**
       * You can pass in flags and a description to customise the built-in help option.
       * Pass in false to disable the built-in help option.
       *
       * @example
       * program.helpOption('-?, --help' 'show help'); // customise
       * program.helpOption(false); // disable
       *
       * @param {(string | boolean)} flags
       * @param {string} [description]
       * @return {Command} `this` command for chaining
       */
      helpOption(flags, description) {
        if (typeof flags === "boolean") {
          if (flags) {
            this._helpOption = this._helpOption ?? void 0;
          } else {
            this._helpOption = null;
          }
          return this;
        }
        flags = flags ?? "-h, --help";
        description = description ?? "display help for command";
        this._helpOption = this.createOption(flags, description);
        return this;
      }
      /**
       * Lazy create help option.
       * Returns null if has been disabled with .helpOption(false).
       *
       * @returns {(Option | null)} the help option
       * @package
       */
      _getHelpOption() {
        if (this._helpOption === void 0) {
          this.helpOption(void 0, void 0);
        }
        return this._helpOption;
      }
      /**
       * Supply your own option to use for the built-in help option.
       * This is an alternative to using helpOption() to customise the flags and description etc.
       *
       * @param {Option} option
       * @return {Command} `this` command for chaining
       */
      addHelpOption(option) {
        this._helpOption = option;
        return this;
      }
      /**
       * Output help information and exit.
       *
       * Outputs built-in help, and custom text added using `.addHelpText()`.
       *
       * @param {{ error: boolean }} [contextOptions] - pass {error:true} to write to stderr instead of stdout
       */
      help(contextOptions) {
        this.outputHelp(contextOptions);
        let exitCode = process2.exitCode || 0;
        if (exitCode === 0 && contextOptions && typeof contextOptions !== "function" && contextOptions.error) {
          exitCode = 1;
        }
        this._exit(exitCode, "commander.help", "(outputHelp)");
      }
      /**
       * Add additional text to be displayed with the built-in help.
       *
       * Position is 'before' or 'after' to affect just this command,
       * and 'beforeAll' or 'afterAll' to affect this command and all its subcommands.
       *
       * @param {string} position - before or after built-in help
       * @param {(string | Function)} text - string to add, or a function returning a string
       * @return {Command} `this` command for chaining
       */
      addHelpText(position, text) {
        const allowedValues = ["beforeAll", "before", "after", "afterAll"];
        if (!allowedValues.includes(position)) {
          throw new Error(`Unexpected value for position to addHelpText.
Expecting one of '${allowedValues.join("', '")}'`);
        }
        const helpEvent = `${position}Help`;
        this.on(helpEvent, (context) => {
          let helpStr;
          if (typeof text === "function") {
            helpStr = text({ error: context.error, command: context.command });
          } else {
            helpStr = text;
          }
          if (helpStr) {
            context.write(`${helpStr}
`);
          }
        });
        return this;
      }
      /**
       * Output help information if help flags specified
       *
       * @param {Array} args - array of options to search for help flags
       * @private
       */
      _outputHelpIfRequested(args) {
        const helpOption = this._getHelpOption();
        const helpRequested = helpOption && args.find((arg) => helpOption.is(arg));
        if (helpRequested) {
          this.outputHelp();
          this._exit(0, "commander.helpDisplayed", "(outputHelp)");
        }
      }
    };
    function incrementNodeInspectorPort(args) {
      return args.map((arg) => {
        if (!arg.startsWith("--inspect")) {
          return arg;
        }
        let debugOption;
        let debugHost = "127.0.0.1";
        let debugPort = "9229";
        let match;
        if ((match = arg.match(/^(--inspect(-brk)?)$/)) !== null) {
          debugOption = match[1];
        } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+)$/)) !== null) {
          debugOption = match[1];
          if (/^\d+$/.test(match[3])) {
            debugPort = match[3];
          } else {
            debugHost = match[3];
          }
        } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+):(\d+)$/)) !== null) {
          debugOption = match[1];
          debugHost = match[3];
          debugPort = match[4];
        }
        if (debugOption && debugPort !== "0") {
          return `${debugOption}=${debugHost}:${parseInt(debugPort) + 1}`;
        }
        return arg;
      });
    }
    exports.Command = Command2;
  }
});

// node_modules/.pnpm/commander@12.1.0/node_modules/commander/index.js
var require_commander = __commonJS({
  "node_modules/.pnpm/commander@12.1.0/node_modules/commander/index.js"(exports) {
    "use strict";
    var { Argument: Argument2 } = require_argument();
    var { Command: Command2 } = require_command();
    var { CommanderError: CommanderError2, InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var { Help: Help2 } = require_help();
    var { Option: Option2 } = require_option();
    exports.program = new Command2();
    exports.createCommand = (name) => new Command2(name);
    exports.createOption = (flags, description) => new Option2(flags, description);
    exports.createArgument = (name, description) => new Argument2(name, description);
    exports.Command = Command2;
    exports.Option = Option2;
    exports.Argument = Argument2;
    exports.Help = Help2;
    exports.CommanderError = CommanderError2;
    exports.InvalidArgumentError = InvalidArgumentError2;
    exports.InvalidOptionArgumentError = InvalidArgumentError2;
  }
});

// node_modules/.pnpm/picocolors@1.1.1/node_modules/picocolors/picocolors.js
var require_picocolors = __commonJS({
  "node_modules/.pnpm/picocolors@1.1.1/node_modules/picocolors/picocolors.js"(exports, module) {
    "use strict";
    var p = process || {};
    var argv = p.argv || [];
    var env = p.env || {};
    var isColorSupported = !(!!env.NO_COLOR || argv.includes("--no-color")) && (!!env.FORCE_COLOR || argv.includes("--color") || p.platform === "win32" || (p.stdout || {}).isTTY && env.TERM !== "dumb" || !!env.CI);
    var formatter = (open, close, replace = open) => (input) => {
      let string = "" + input, index = string.indexOf(close, open.length);
      return ~index ? open + replaceClose(string, close, replace, index) + close : open + string + close;
    };
    var replaceClose = (string, close, replace, index) => {
      let result = "", cursor = 0;
      do {
        result += string.substring(cursor, index) + replace;
        cursor = index + close.length;
        index = string.indexOf(close, cursor);
      } while (~index);
      return result + string.substring(cursor);
    };
    var createColors = (enabled = isColorSupported) => {
      let f2 = enabled ? formatter : () => String;
      return {
        isColorSupported: enabled,
        reset: f2("\x1B[0m", "\x1B[0m"),
        bold: f2("\x1B[1m", "\x1B[22m", "\x1B[22m\x1B[1m"),
        dim: f2("\x1B[2m", "\x1B[22m", "\x1B[22m\x1B[2m"),
        italic: f2("\x1B[3m", "\x1B[23m"),
        underline: f2("\x1B[4m", "\x1B[24m"),
        inverse: f2("\x1B[7m", "\x1B[27m"),
        hidden: f2("\x1B[8m", "\x1B[28m"),
        strikethrough: f2("\x1B[9m", "\x1B[29m"),
        black: f2("\x1B[30m", "\x1B[39m"),
        red: f2("\x1B[31m", "\x1B[39m"),
        green: f2("\x1B[32m", "\x1B[39m"),
        yellow: f2("\x1B[33m", "\x1B[39m"),
        blue: f2("\x1B[34m", "\x1B[39m"),
        magenta: f2("\x1B[35m", "\x1B[39m"),
        cyan: f2("\x1B[36m", "\x1B[39m"),
        white: f2("\x1B[37m", "\x1B[39m"),
        gray: f2("\x1B[90m", "\x1B[39m"),
        bgBlack: f2("\x1B[40m", "\x1B[49m"),
        bgRed: f2("\x1B[41m", "\x1B[49m"),
        bgGreen: f2("\x1B[42m", "\x1B[49m"),
        bgYellow: f2("\x1B[43m", "\x1B[49m"),
        bgBlue: f2("\x1B[44m", "\x1B[49m"),
        bgMagenta: f2("\x1B[45m", "\x1B[49m"),
        bgCyan: f2("\x1B[46m", "\x1B[49m"),
        bgWhite: f2("\x1B[47m", "\x1B[49m"),
        blackBright: f2("\x1B[90m", "\x1B[39m"),
        redBright: f2("\x1B[91m", "\x1B[39m"),
        greenBright: f2("\x1B[92m", "\x1B[39m"),
        yellowBright: f2("\x1B[93m", "\x1B[39m"),
        blueBright: f2("\x1B[94m", "\x1B[39m"),
        magentaBright: f2("\x1B[95m", "\x1B[39m"),
        cyanBright: f2("\x1B[96m", "\x1B[39m"),
        whiteBright: f2("\x1B[97m", "\x1B[39m"),
        bgBlackBright: f2("\x1B[100m", "\x1B[49m"),
        bgRedBright: f2("\x1B[101m", "\x1B[49m"),
        bgGreenBright: f2("\x1B[102m", "\x1B[49m"),
        bgYellowBright: f2("\x1B[103m", "\x1B[49m"),
        bgBlueBright: f2("\x1B[104m", "\x1B[49m"),
        bgMagentaBright: f2("\x1B[105m", "\x1B[49m"),
        bgCyanBright: f2("\x1B[106m", "\x1B[49m"),
        bgWhiteBright: f2("\x1B[107m", "\x1B[49m")
      };
    };
    module.exports = createColors();
    module.exports.createColors = createColors;
  }
});

// node_modules/.pnpm/sisteransi@1.0.5/node_modules/sisteransi/src/index.js
var require_src = __commonJS({
  "node_modules/.pnpm/sisteransi@1.0.5/node_modules/sisteransi/src/index.js"(exports, module) {
    "use strict";
    var ESC = "\x1B";
    var CSI = `${ESC}[`;
    var beep = "\x07";
    var cursor = {
      to(x2, y3) {
        if (!y3) return `${CSI}${x2 + 1}G`;
        return `${CSI}${y3 + 1};${x2 + 1}H`;
      },
      move(x2, y3) {
        let ret = "";
        if (x2 < 0) ret += `${CSI}${-x2}D`;
        else if (x2 > 0) ret += `${CSI}${x2}C`;
        if (y3 < 0) ret += `${CSI}${-y3}A`;
        else if (y3 > 0) ret += `${CSI}${y3}B`;
        return ret;
      },
      up: (count = 1) => `${CSI}${count}A`,
      down: (count = 1) => `${CSI}${count}B`,
      forward: (count = 1) => `${CSI}${count}C`,
      backward: (count = 1) => `${CSI}${count}D`,
      nextLine: (count = 1) => `${CSI}E`.repeat(count),
      prevLine: (count = 1) => `${CSI}F`.repeat(count),
      left: `${CSI}G`,
      hide: `${CSI}?25l`,
      show: `${CSI}?25h`,
      save: `${ESC}7`,
      restore: `${ESC}8`
    };
    var scroll = {
      up: (count = 1) => `${CSI}S`.repeat(count),
      down: (count = 1) => `${CSI}T`.repeat(count)
    };
    var erase = {
      screen: `${CSI}2J`,
      up: (count = 1) => `${CSI}1J`.repeat(count),
      down: (count = 1) => `${CSI}J`.repeat(count),
      line: `${CSI}2K`,
      lineEnd: `${CSI}K`,
      lineStart: `${CSI}1K`,
      lines(count) {
        let clear = "";
        for (let i = 0; i < count; i++)
          clear += this.line + (i < count - 1 ? cursor.up() : "");
        if (count)
          clear += cursor.left;
        return clear;
      }
    };
    module.exports = { cursor, scroll, erase, beep };
  }
});

// node_modules/.pnpm/commander@12.1.0/node_modules/commander/esm.mjs
var import_index = __toESM(require_commander(), 1);
var {
  program,
  createCommand,
  createArgument,
  createOption,
  CommanderError,
  InvalidArgumentError,
  InvalidOptionArgumentError,
  // deprecated old name
  Command,
  Argument,
  Option,
  Help
} = import_index.default;

// bin/learnhouse.ts
var import_picocolors16 = __toESM(require_picocolors(), 1);

// src/constants.ts
var VERSION = "1.0.1";
var APP_IMAGE = "ghcr.io/learnhouse/app:latest";
var POSTGRES_IMAGE = "postgres:16-alpine";
var POSTGRES_AI_IMAGE = "pgvector/pgvector:pg16";
var HEALTH_CHECK_TIMEOUT_MS = 18e4;
var HEALTH_CHECK_INTERVAL_MS = 3e3;
var CONFIG_FILENAME = "learnhouse.config.json";

// src/ui/banner.ts
var import_picocolors = __toESM(require_picocolors(), 1);
var ICON = [
  "          \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588          ",
  "         \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588         ",
  "         \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588         ",
  "       \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588       ",
  "     \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588     ",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588    \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588      \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588          \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588              \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588                  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588                        \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588"
];
var ICON_W = Math.max(...ICON.map((l2) => l2.length));
function center(s, width) {
  const pad = Math.max(0, width - s.length);
  return " ".repeat(Math.floor(pad / 2)) + s;
}
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
function padStyled(styled, width) {
  const visible = stripAnsi(styled).length;
  return styled + " ".repeat(Math.max(0, width - visible));
}
var BOX_W = 44;
function boxLine(content) {
  return import_picocolors.default.dim("\u2502") + " " + padStyled(content, BOX_W) + " " + import_picocolors.default.dim("\u2502");
}
function buildInfoBox() {
  const top = import_picocolors.default.dim("\u250C" + "\u2500".repeat(BOX_W + 2) + "\u2510");
  const bot = import_picocolors.default.dim("\u2514" + "\u2500".repeat(BOX_W + 2) + "\u2518");
  const sep = import_picocolors.default.dim("\u2500".repeat(BOX_W));
  const empty = boxLine("");
  return [
    top,
    boxLine(import_picocolors.default.bold(import_picocolors.default.white("LearnHouse")) + import_picocolors.default.dim(` // v${VERSION}`)),
    boxLine(sep),
    boxLine(import_picocolors.default.white("Deploy LearnHouse with a single command.")),
    boxLine(import_picocolors.default.white("Handles configuration, Docker, SSL, DB.")),
    empty,
    boxLine(import_picocolors.default.white("> ") + import_picocolors.default.dim("npx learnhouse@latest")),
    bot
  ];
}
async function printBanner() {
  console.log();
  for (const line of ICON) {
    console.log(import_picocolors.default.white(center(line, ICON_W)));
  }
  console.log();
  const box = buildInfoBox();
  for (const line of box) {
    const visible = stripAnsi(line).length;
    const pad = Math.max(0, Math.floor((ICON_W - visible) / 2));
    console.log(" ".repeat(pad) + line);
  }
  console.log();
}

// src/services/version-check.ts
var import_picocolors2 = __toESM(require_picocolors(), 1);
var NPM_REGISTRY_URL = "https://registry.npmjs.org/learnhouse";
var GHCR_BASE = "ghcr.io/learnhouse/app";
function compareVersions(a3, b3) {
  const pa = a3.split(".").map(Number);
  const pb = b3.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}
async function checkForUpdates() {
  try {
    const resp = await fetch(NPM_REGISTRY_URL, {
      signal: AbortSignal.timeout(3e3),
      headers: { Accept: "application/json" }
    });
    if (!resp.ok) return;
    const data = await resp.json();
    const latest = data["dist-tags"]?.latest;
    if (!latest) return;
    if (compareVersions(latest, VERSION) > 0) {
      console.log();
      console.log(import_picocolors2.default.yellow(`  Update available: ${VERSION} \u2192 ${import_picocolors2.default.bold(latest)}`));
      console.log(import_picocolors2.default.dim(`  Run: npx learnhouse@latest`));
      console.log();
    }
  } catch {
  }
}
async function resolveAppImage() {
  const versionedTag = `${GHCR_BASE}:${VERSION}`;
  try {
    const tokenResp = await fetch(
      `https://ghcr.io/token?scope=repository:learnhouse/app:pull`,
      { signal: AbortSignal.timeout(5e3) }
    );
    if (!tokenResp.ok) throw new Error("token fetch failed");
    const { token } = await tokenResp.json();
    const manifestResp = await fetch(
      `https://ghcr.io/v2/learnhouse/app/manifests/${VERSION}`,
      {
        signal: AbortSignal.timeout(5e3),
        headers: {
          Accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
          Authorization: `Bearer ${token}`
        }
      }
    );
    if (manifestResp.ok) {
      return { image: versionedTag, isLatest: false };
    }
  } catch {
  }
  return { image: `${GHCR_BASE}:latest`, isLatest: true };
}

// src/commands/setup.ts
import crypto3 from "crypto";
import fs2 from "fs";
import path2 from "path";

// node_modules/.pnpm/@clack+core@0.3.5/node_modules/@clack/core/dist/index.mjs
var import_sisteransi = __toESM(require_src(), 1);
var import_picocolors3 = __toESM(require_picocolors(), 1);
import { stdin as $, stdout as k } from "process";
import * as f from "readline";
import _ from "readline";
import { WriteStream as U } from "tty";
function q({ onlyFirst: e2 = false } = {}) {
  const F = ["[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?(?:\\u0007|\\u001B\\u005C|\\u009C))", "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))"].join("|");
  return new RegExp(F, e2 ? void 0 : "g");
}
var J = q();
function S(e2) {
  if (typeof e2 != "string") throw new TypeError(`Expected a \`string\`, got \`${typeof e2}\``);
  return e2.replace(J, "");
}
function T(e2) {
  return e2 && e2.__esModule && Object.prototype.hasOwnProperty.call(e2, "default") ? e2.default : e2;
}
var j = { exports: {} };
(function(e2) {
  var u2 = {};
  e2.exports = u2, u2.eastAsianWidth = function(t) {
    var s = t.charCodeAt(0), C2 = t.length == 2 ? t.charCodeAt(1) : 0, D = s;
    return 55296 <= s && s <= 56319 && 56320 <= C2 && C2 <= 57343 && (s &= 1023, C2 &= 1023, D = s << 10 | C2, D += 65536), D == 12288 || 65281 <= D && D <= 65376 || 65504 <= D && D <= 65510 ? "F" : D == 8361 || 65377 <= D && D <= 65470 || 65474 <= D && D <= 65479 || 65482 <= D && D <= 65487 || 65490 <= D && D <= 65495 || 65498 <= D && D <= 65500 || 65512 <= D && D <= 65518 ? "H" : 4352 <= D && D <= 4447 || 4515 <= D && D <= 4519 || 4602 <= D && D <= 4607 || 9001 <= D && D <= 9002 || 11904 <= D && D <= 11929 || 11931 <= D && D <= 12019 || 12032 <= D && D <= 12245 || 12272 <= D && D <= 12283 || 12289 <= D && D <= 12350 || 12353 <= D && D <= 12438 || 12441 <= D && D <= 12543 || 12549 <= D && D <= 12589 || 12593 <= D && D <= 12686 || 12688 <= D && D <= 12730 || 12736 <= D && D <= 12771 || 12784 <= D && D <= 12830 || 12832 <= D && D <= 12871 || 12880 <= D && D <= 13054 || 13056 <= D && D <= 19903 || 19968 <= D && D <= 42124 || 42128 <= D && D <= 42182 || 43360 <= D && D <= 43388 || 44032 <= D && D <= 55203 || 55216 <= D && D <= 55238 || 55243 <= D && D <= 55291 || 63744 <= D && D <= 64255 || 65040 <= D && D <= 65049 || 65072 <= D && D <= 65106 || 65108 <= D && D <= 65126 || 65128 <= D && D <= 65131 || 110592 <= D && D <= 110593 || 127488 <= D && D <= 127490 || 127504 <= D && D <= 127546 || 127552 <= D && D <= 127560 || 127568 <= D && D <= 127569 || 131072 <= D && D <= 194367 || 177984 <= D && D <= 196605 || 196608 <= D && D <= 262141 ? "W" : 32 <= D && D <= 126 || 162 <= D && D <= 163 || 165 <= D && D <= 166 || D == 172 || D == 175 || 10214 <= D && D <= 10221 || 10629 <= D && D <= 10630 ? "Na" : D == 161 || D == 164 || 167 <= D && D <= 168 || D == 170 || 173 <= D && D <= 174 || 176 <= D && D <= 180 || 182 <= D && D <= 186 || 188 <= D && D <= 191 || D == 198 || D == 208 || 215 <= D && D <= 216 || 222 <= D && D <= 225 || D == 230 || 232 <= D && D <= 234 || 236 <= D && D <= 237 || D == 240 || 242 <= D && D <= 243 || 247 <= D && D <= 250 || D == 252 || D == 254 || D == 257 || D == 273 || D == 275 || D == 283 || 294 <= D && D <= 295 || D == 299 || 305 <= D && D <= 307 || D == 312 || 319 <= D && D <= 322 || D == 324 || 328 <= D && D <= 331 || D == 333 || 338 <= D && D <= 339 || 358 <= D && D <= 359 || D == 363 || D == 462 || D == 464 || D == 466 || D == 468 || D == 470 || D == 472 || D == 474 || D == 476 || D == 593 || D == 609 || D == 708 || D == 711 || 713 <= D && D <= 715 || D == 717 || D == 720 || 728 <= D && D <= 731 || D == 733 || D == 735 || 768 <= D && D <= 879 || 913 <= D && D <= 929 || 931 <= D && D <= 937 || 945 <= D && D <= 961 || 963 <= D && D <= 969 || D == 1025 || 1040 <= D && D <= 1103 || D == 1105 || D == 8208 || 8211 <= D && D <= 8214 || 8216 <= D && D <= 8217 || 8220 <= D && D <= 8221 || 8224 <= D && D <= 8226 || 8228 <= D && D <= 8231 || D == 8240 || 8242 <= D && D <= 8243 || D == 8245 || D == 8251 || D == 8254 || D == 8308 || D == 8319 || 8321 <= D && D <= 8324 || D == 8364 || D == 8451 || D == 8453 || D == 8457 || D == 8467 || D == 8470 || 8481 <= D && D <= 8482 || D == 8486 || D == 8491 || 8531 <= D && D <= 8532 || 8539 <= D && D <= 8542 || 8544 <= D && D <= 8555 || 8560 <= D && D <= 8569 || D == 8585 || 8592 <= D && D <= 8601 || 8632 <= D && D <= 8633 || D == 8658 || D == 8660 || D == 8679 || D == 8704 || 8706 <= D && D <= 8707 || 8711 <= D && D <= 8712 || D == 8715 || D == 8719 || D == 8721 || D == 8725 || D == 8730 || 8733 <= D && D <= 8736 || D == 8739 || D == 8741 || 8743 <= D && D <= 8748 || D == 8750 || 8756 <= D && D <= 8759 || 8764 <= D && D <= 8765 || D == 8776 || D == 8780 || D == 8786 || 8800 <= D && D <= 8801 || 8804 <= D && D <= 8807 || 8810 <= D && D <= 8811 || 8814 <= D && D <= 8815 || 8834 <= D && D <= 8835 || 8838 <= D && D <= 8839 || D == 8853 || D == 8857 || D == 8869 || D == 8895 || D == 8978 || 9312 <= D && D <= 9449 || 9451 <= D && D <= 9547 || 9552 <= D && D <= 9587 || 9600 <= D && D <= 9615 || 9618 <= D && D <= 9621 || 9632 <= D && D <= 9633 || 9635 <= D && D <= 9641 || 9650 <= D && D <= 9651 || 9654 <= D && D <= 9655 || 9660 <= D && D <= 9661 || 9664 <= D && D <= 9665 || 9670 <= D && D <= 9672 || D == 9675 || 9678 <= D && D <= 9681 || 9698 <= D && D <= 9701 || D == 9711 || 9733 <= D && D <= 9734 || D == 9737 || 9742 <= D && D <= 9743 || 9748 <= D && D <= 9749 || D == 9756 || D == 9758 || D == 9792 || D == 9794 || 9824 <= D && D <= 9825 || 9827 <= D && D <= 9829 || 9831 <= D && D <= 9834 || 9836 <= D && D <= 9837 || D == 9839 || 9886 <= D && D <= 9887 || 9918 <= D && D <= 9919 || 9924 <= D && D <= 9933 || 9935 <= D && D <= 9953 || D == 9955 || 9960 <= D && D <= 9983 || D == 10045 || D == 10071 || 10102 <= D && D <= 10111 || 11093 <= D && D <= 11097 || 12872 <= D && D <= 12879 || 57344 <= D && D <= 63743 || 65024 <= D && D <= 65039 || D == 65533 || 127232 <= D && D <= 127242 || 127248 <= D && D <= 127277 || 127280 <= D && D <= 127337 || 127344 <= D && D <= 127386 || 917760 <= D && D <= 917999 || 983040 <= D && D <= 1048573 || 1048576 <= D && D <= 1114109 ? "A" : "N";
  }, u2.characterLength = function(t) {
    var s = this.eastAsianWidth(t);
    return s == "F" || s == "W" || s == "A" ? 2 : 1;
  };
  function F(t) {
    return t.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\uD800-\uDFFF]/g) || [];
  }
  u2.length = function(t) {
    for (var s = F(t), C2 = 0, D = 0; D < s.length; D++) C2 = C2 + this.characterLength(s[D]);
    return C2;
  }, u2.slice = function(t, s, C2) {
    textLen = u2.length(t), s = s || 0, C2 = C2 || 1, s < 0 && (s = textLen + s), C2 < 0 && (C2 = textLen + C2);
    for (var D = "", i = 0, n = F(t), E2 = 0; E2 < n.length; E2++) {
      var h2 = n[E2], o = u2.length(h2);
      if (i >= s - (o == 2 ? 1 : 0)) if (i + o <= C2) D += h2;
      else break;
      i += o;
    }
    return D;
  };
})(j);
var Q = j.exports;
var X = T(Q);
var DD = function() {
  return /\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62(?:\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73|\uDB40\uDC73\uDB40\uDC63\uDB40\uDC74|\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67)\uDB40\uDC7F|(?:\uD83E\uDDD1\uD83C\uDFFF\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFF\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB-\uDFFE])|(?:\uD83E\uDDD1\uD83C\uDFFE\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFE\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB-\uDFFD\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFD\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFD\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFC\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFC\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB\uDFFD-\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFB\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFB\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFC-\uDFFF])|\uD83D\uDC68(?:\uD83C\uDFFB(?:\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF]))|\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFC-\uDFFF])|[\u2695\u2696\u2708]\uFE0F|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))?|(?:\uD83C[\uDFFC-\uDFFF])\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF]))|\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83D\uDC68|(?:\uD83D[\uDC68\uDC69])\u200D(?:\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67]))|\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFE])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])\uFE0F|\u200D(?:(?:\uD83D[\uDC68\uDC69])\u200D(?:\uD83D[\uDC66\uDC67])|\uD83D[\uDC66\uDC67])|\uD83C\uDFFF|\uD83C\uDFFE|\uD83C\uDFFD|\uD83C\uDFFC)?|(?:\uD83D\uDC69(?:\uD83C\uDFFB\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69])|(?:\uD83C[\uDFFC-\uDFFF])\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69]))|\uD83E\uDDD1(?:\uD83C[\uDFFB-\uDFFF])\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1)(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC69\u200D\uD83D\uDC69\u200D(?:\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67]))|\uD83D\uDC69(?:\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFB\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))|\uD83E\uDDD1(?:\u200D(?:\uD83E\uDD1D\u200D\uD83E\uDDD1|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFB\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))|\uD83D\uDC69\u200D\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC69\u200D\uD83D\uDC69\u200D(?:\uD83D[\uDC66\uDC67])|\uD83D\uDC69\u200D\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|(?:\uD83D\uDC41\uFE0F\u200D\uD83D\uDDE8|\uD83E\uDDD1(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\uD83C\uDFFB\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])|\uD83D\uDC69(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\uD83C\uDFFB\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])|\uD83D\uDE36\u200D\uD83C\uDF2B|\uD83C\uDFF3\uFE0F\u200D\u26A7|\uD83D\uDC3B\u200D\u2744|(?:(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD])(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC6F|\uD83E[\uDD3C\uDDDE\uDDDF])\u200D[\u2640\u2642]|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uFE0F|\uD83C[\uDFFB-\uDFFF])\u200D[\u2640\u2642]|\uD83C\uDFF4\u200D\u2620|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD])\u200D[\u2640\u2642]|[\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u2328\u23CF\u23ED-\u23EF\u23F1\u23F2\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB\u25FC\u2600-\u2604\u260E\u2611\u2618\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u2692\u2694-\u2697\u2699\u269B\u269C\u26A0\u26A7\u26B0\u26B1\u26C8\u26CF\u26D1\u26D3\u26E9\u26F0\u26F1\u26F4\u26F7\u26F8\u2702\u2708\u2709\u270F\u2712\u2714\u2716\u271D\u2721\u2733\u2734\u2744\u2747\u2763\u27A1\u2934\u2935\u2B05-\u2B07\u3030\u303D\u3297\u3299]|\uD83C[\uDD70\uDD71\uDD7E\uDD7F\uDE02\uDE37\uDF21\uDF24-\uDF2C\uDF36\uDF7D\uDF96\uDF97\uDF99-\uDF9B\uDF9E\uDF9F\uDFCD\uDFCE\uDFD4-\uDFDF\uDFF5\uDFF7]|\uD83D[\uDC3F\uDCFD\uDD49\uDD4A\uDD6F\uDD70\uDD73\uDD76-\uDD79\uDD87\uDD8A-\uDD8D\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA\uDECB\uDECD-\uDECF\uDEE0-\uDEE5\uDEE9\uDEF0\uDEF3])\uFE0F|\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08|\uD83D\uDC69\u200D\uD83D\uDC67|\uD83D\uDC69\u200D\uD83D\uDC66|\uD83D\uDE35\u200D\uD83D\uDCAB|\uD83D\uDE2E\u200D\uD83D\uDCA8|\uD83D\uDC15\u200D\uD83E\uDDBA|\uD83E\uDDD1(?:\uD83C\uDFFF|\uD83C\uDFFE|\uD83C\uDFFD|\uD83C\uDFFC|\uD83C\uDFFB)?|\uD83D\uDC69(?:\uD83C\uDFFF|\uD83C\uDFFE|\uD83C\uDFFD|\uD83C\uDFFC|\uD83C\uDFFB)?|\uD83C\uDDFD\uD83C\uDDF0|\uD83C\uDDF6\uD83C\uDDE6|\uD83C\uDDF4\uD83C\uDDF2|\uD83D\uDC08\u200D\u2B1B|\u2764\uFE0F\u200D(?:\uD83D\uDD25|\uD83E\uDE79)|\uD83D\uDC41\uFE0F|\uD83C\uDFF3\uFE0F|\uD83C\uDDFF(?:\uD83C[\uDDE6\uDDF2\uDDFC])|\uD83C\uDDFE(?:\uD83C[\uDDEA\uDDF9])|\uD83C\uDDFC(?:\uD83C[\uDDEB\uDDF8])|\uD83C\uDDFB(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDEE\uDDF3\uDDFA])|\uD83C\uDDFA(?:\uD83C[\uDDE6\uDDEC\uDDF2\uDDF3\uDDF8\uDDFE\uDDFF])|\uD83C\uDDF9(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDED\uDDEF-\uDDF4\uDDF7\uDDF9\uDDFB\uDDFC\uDDFF])|\uD83C\uDDF8(?:\uD83C[\uDDE6-\uDDEA\uDDEC-\uDDF4\uDDF7-\uDDF9\uDDFB\uDDFD-\uDDFF])|\uD83C\uDDF7(?:\uD83C[\uDDEA\uDDF4\uDDF8\uDDFA\uDDFC])|\uD83C\uDDF5(?:\uD83C[\uDDE6\uDDEA-\uDDED\uDDF0-\uDDF3\uDDF7-\uDDF9\uDDFC\uDDFE])|\uD83C\uDDF3(?:\uD83C[\uDDE6\uDDE8\uDDEA-\uDDEC\uDDEE\uDDF1\uDDF4\uDDF5\uDDF7\uDDFA\uDDFF])|\uD83C\uDDF2(?:\uD83C[\uDDE6\uDDE8-\uDDED\uDDF0-\uDDFF])|\uD83C\uDDF1(?:\uD83C[\uDDE6-\uDDE8\uDDEE\uDDF0\uDDF7-\uDDFB\uDDFE])|\uD83C\uDDF0(?:\uD83C[\uDDEA\uDDEC-\uDDEE\uDDF2\uDDF3\uDDF5\uDDF7\uDDFC\uDDFE\uDDFF])|\uD83C\uDDEF(?:\uD83C[\uDDEA\uDDF2\uDDF4\uDDF5])|\uD83C\uDDEE(?:\uD83C[\uDDE8-\uDDEA\uDDF1-\uDDF4\uDDF6-\uDDF9])|\uD83C\uDDED(?:\uD83C[\uDDF0\uDDF2\uDDF3\uDDF7\uDDF9\uDDFA])|\uD83C\uDDEC(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEE\uDDF1-\uDDF3\uDDF5-\uDDFA\uDDFC\uDDFE])|\uD83C\uDDEB(?:\uD83C[\uDDEE-\uDDF0\uDDF2\uDDF4\uDDF7])|\uD83C\uDDEA(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDED\uDDF7-\uDDFA])|\uD83C\uDDE9(?:\uD83C[\uDDEA\uDDEC\uDDEF\uDDF0\uDDF2\uDDF4\uDDFF])|\uD83C\uDDE8(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDEE\uDDF0-\uDDF5\uDDF7\uDDFA-\uDDFF])|\uD83C\uDDE7(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEF\uDDF1-\uDDF4\uDDF6-\uDDF9\uDDFB\uDDFC\uDDFE\uDDFF])|\uD83C\uDDE6(?:\uD83C[\uDDE8-\uDDEC\uDDEE\uDDF1\uDDF2\uDDF4\uDDF6-\uDDFA\uDDFC\uDDFD\uDDFF])|[#\*0-9]\uFE0F\u20E3|\u2764\uFE0F|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD])(?:\uD83C[\uDFFB-\uDFFF])|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uFE0F|\uD83C[\uDFFB-\uDFFF])|\uD83C\uDFF4|(?:[\u270A\u270B]|\uD83C[\uDF85\uDFC2\uDFC7]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDC8F\uDC91\uDCAA\uDD7A\uDD95\uDD96\uDE4C\uDE4F\uDEC0\uDECC]|\uD83E[\uDD0C\uDD0F\uDD18-\uDD1C\uDD1E\uDD1F\uDD30-\uDD34\uDD36\uDD77\uDDB5\uDDB6\uDDBB\uDDD2\uDDD3\uDDD5])(?:\uD83C[\uDFFB-\uDFFF])|(?:[\u261D\u270C\u270D]|\uD83D[\uDD74\uDD90])(?:\uFE0F|\uD83C[\uDFFB-\uDFFF])|[\u270A\u270B]|\uD83C[\uDF85\uDFC2\uDFC7]|\uD83D[\uDC08\uDC15\uDC3B\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDC8F\uDC91\uDCAA\uDD7A\uDD95\uDD96\uDE2E\uDE35\uDE36\uDE4C\uDE4F\uDEC0\uDECC]|\uD83E[\uDD0C\uDD0F\uDD18-\uDD1C\uDD1E\uDD1F\uDD30-\uDD34\uDD36\uDD77\uDDB5\uDDB6\uDDBB\uDDD2\uDDD3\uDDD5]|\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD]|\uD83D\uDC6F|\uD83E[\uDD3C\uDDDE\uDDDF]|[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55]|\uD83C[\uDC04\uDCCF\uDD8E\uDD91-\uDD9A\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF7C\uDF7E-\uDF84\uDF86-\uDF93\uDFA0-\uDFC1\uDFC5\uDFC6\uDFC8\uDFC9\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF8-\uDFFF]|\uD83D[\uDC00-\uDC07\uDC09-\uDC14\uDC16-\uDC3A\uDC3C-\uDC3E\uDC40\uDC44\uDC45\uDC51-\uDC65\uDC6A\uDC79-\uDC7B\uDC7D-\uDC80\uDC84\uDC88-\uDC8E\uDC90\uDC92-\uDCA9\uDCAB-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDDA4\uDDFB-\uDE2D\uDE2F-\uDE34\uDE37-\uDE44\uDE48-\uDE4A\uDE80-\uDEA2\uDEA4-\uDEB3\uDEB7-\uDEBF\uDEC1-\uDEC5\uDED0-\uDED2\uDED5-\uDED7\uDEEB\uDEEC\uDEF4-\uDEFC\uDFE0-\uDFEB]|\uD83E[\uDD0D\uDD0E\uDD10-\uDD17\uDD1D\uDD20-\uDD25\uDD27-\uDD2F\uDD3A\uDD3F-\uDD45\uDD47-\uDD76\uDD78\uDD7A-\uDDB4\uDDB7\uDDBA\uDDBC-\uDDCB\uDDD0\uDDE0-\uDDFF\uDE70-\uDE74\uDE78-\uDE7A\uDE80-\uDE86\uDE90-\uDEA8\uDEB0-\uDEB6\uDEC0-\uDEC2\uDED0-\uDED6]|(?:[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u270A\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55]|\uD83C[\uDC04\uDCCF\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF7C\uDF7E-\uDF93\uDFA0-\uDFCA\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF4\uDFF8-\uDFFF]|\uD83D[\uDC00-\uDC3E\uDC40\uDC42-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDD7A\uDD95\uDD96\uDDA4\uDDFB-\uDE4F\uDE80-\uDEC5\uDECC\uDED0-\uDED2\uDED5-\uDED7\uDEEB\uDEEC\uDEF4-\uDEFC\uDFE0-\uDFEB]|\uD83E[\uDD0C-\uDD3A\uDD3C-\uDD45\uDD47-\uDD78\uDD7A-\uDDCB\uDDCD-\uDDFF\uDE70-\uDE74\uDE78-\uDE7A\uDE80-\uDE86\uDE90-\uDEA8\uDEB0-\uDEB6\uDEC0-\uDEC2\uDED0-\uDED6])|(?:[#\*0-9\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23E9-\u23F3\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u261D\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u267F\u2692-\u2697\u2699\u269B\u269C\u26A0\u26A1\u26A7\u26AA\u26AB\u26B0\u26B1\u26BD\u26BE\u26C4\u26C5\u26C8\u26CE\u26CF\u26D1\u26D3\u26D4\u26E9\u26EA\u26F0-\u26F5\u26F7-\u26FA\u26FD\u2702\u2705\u2708-\u270D\u270F\u2712\u2714\u2716\u271D\u2721\u2728\u2733\u2734\u2744\u2747\u274C\u274E\u2753-\u2755\u2757\u2763\u2764\u2795-\u2797\u27A1\u27B0\u27BF\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299]|\uD83C[\uDC04\uDCCF\uDD70\uDD71\uDD7E\uDD7F\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE02\uDE1A\uDE2F\uDE32-\uDE3A\uDE50\uDE51\uDF00-\uDF21\uDF24-\uDF93\uDF96\uDF97\uDF99-\uDF9B\uDF9E-\uDFF0\uDFF3-\uDFF5\uDFF7-\uDFFF]|\uD83D[\uDC00-\uDCFD\uDCFF-\uDD3D\uDD49-\uDD4E\uDD50-\uDD67\uDD6F\uDD70\uDD73-\uDD7A\uDD87\uDD8A-\uDD8D\uDD90\uDD95\uDD96\uDDA4\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA-\uDE4F\uDE80-\uDEC5\uDECB-\uDED2\uDED5-\uDED7\uDEE0-\uDEE5\uDEE9\uDEEB\uDEEC\uDEF0\uDEF3-\uDEFC\uDFE0-\uDFEB]|\uD83E[\uDD0C-\uDD3A\uDD3C-\uDD45\uDD47-\uDD78\uDD7A-\uDDCB\uDDCD-\uDDFF\uDE70-\uDE74\uDE78-\uDE7A\uDE80-\uDE86\uDE90-\uDEA8\uDEB0-\uDEB6\uDEC0-\uDEC2\uDED0-\uDED6])\uFE0F|(?:[\u261D\u26F9\u270A-\u270D]|\uD83C[\uDF85\uDFC2-\uDFC4\uDFC7\uDFCA-\uDFCC]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66-\uDC78\uDC7C\uDC81-\uDC83\uDC85-\uDC87\uDC8F\uDC91\uDCAA\uDD74\uDD75\uDD7A\uDD90\uDD95\uDD96\uDE45-\uDE47\uDE4B-\uDE4F\uDEA3\uDEB4-\uDEB6\uDEC0\uDECC]|\uD83E[\uDD0C\uDD0F\uDD18-\uDD1F\uDD26\uDD30-\uDD39\uDD3C-\uDD3E\uDD77\uDDB5\uDDB6\uDDB8\uDDB9\uDDBB\uDDCD-\uDDCF\uDDD1-\uDDDD])/g;
};
var uD = T(DD);
function A(e2, u2 = {}) {
  if (typeof e2 != "string" || e2.length === 0 || (u2 = { ambiguousIsNarrow: true, ...u2 }, e2 = S(e2), e2.length === 0)) return 0;
  e2 = e2.replace(uD(), "  ");
  const F = u2.ambiguousIsNarrow ? 1 : 2;
  let t = 0;
  for (const s of e2) {
    const C2 = s.codePointAt(0);
    if (C2 <= 31 || C2 >= 127 && C2 <= 159 || C2 >= 768 && C2 <= 879) continue;
    switch (X.eastAsianWidth(s)) {
      case "F":
      case "W":
        t += 2;
        break;
      case "A":
        t += F;
        break;
      default:
        t += 1;
    }
  }
  return t;
}
var d = 10;
var M = (e2 = 0) => (u2) => `\x1B[${u2 + e2}m`;
var P = (e2 = 0) => (u2) => `\x1B[${38 + e2};5;${u2}m`;
var W = (e2 = 0) => (u2, F, t) => `\x1B[${38 + e2};2;${u2};${F};${t}m`;
var r = { modifier: { reset: [0, 0], bold: [1, 22], dim: [2, 22], italic: [3, 23], underline: [4, 24], overline: [53, 55], inverse: [7, 27], hidden: [8, 28], strikethrough: [9, 29] }, color: { black: [30, 39], red: [31, 39], green: [32, 39], yellow: [33, 39], blue: [34, 39], magenta: [35, 39], cyan: [36, 39], white: [37, 39], blackBright: [90, 39], gray: [90, 39], grey: [90, 39], redBright: [91, 39], greenBright: [92, 39], yellowBright: [93, 39], blueBright: [94, 39], magentaBright: [95, 39], cyanBright: [96, 39], whiteBright: [97, 39] }, bgColor: { bgBlack: [40, 49], bgRed: [41, 49], bgGreen: [42, 49], bgYellow: [43, 49], bgBlue: [44, 49], bgMagenta: [45, 49], bgCyan: [46, 49], bgWhite: [47, 49], bgBlackBright: [100, 49], bgGray: [100, 49], bgGrey: [100, 49], bgRedBright: [101, 49], bgGreenBright: [102, 49], bgYellowBright: [103, 49], bgBlueBright: [104, 49], bgMagentaBright: [105, 49], bgCyanBright: [106, 49], bgWhiteBright: [107, 49] } };
Object.keys(r.modifier);
var FD = Object.keys(r.color);
var eD = Object.keys(r.bgColor);
[...FD, ...eD];
function tD() {
  const e2 = /* @__PURE__ */ new Map();
  for (const [u2, F] of Object.entries(r)) {
    for (const [t, s] of Object.entries(F)) r[t] = { open: `\x1B[${s[0]}m`, close: `\x1B[${s[1]}m` }, F[t] = r[t], e2.set(s[0], s[1]);
    Object.defineProperty(r, u2, { value: F, enumerable: false });
  }
  return Object.defineProperty(r, "codes", { value: e2, enumerable: false }), r.color.close = "\x1B[39m", r.bgColor.close = "\x1B[49m", r.color.ansi = M(), r.color.ansi256 = P(), r.color.ansi16m = W(), r.bgColor.ansi = M(d), r.bgColor.ansi256 = P(d), r.bgColor.ansi16m = W(d), Object.defineProperties(r, { rgbToAnsi256: { value: (u2, F, t) => u2 === F && F === t ? u2 < 8 ? 16 : u2 > 248 ? 231 : Math.round((u2 - 8) / 247 * 24) + 232 : 16 + 36 * Math.round(u2 / 255 * 5) + 6 * Math.round(F / 255 * 5) + Math.round(t / 255 * 5), enumerable: false }, hexToRgb: { value: (u2) => {
    const F = /[a-f\d]{6}|[a-f\d]{3}/i.exec(u2.toString(16));
    if (!F) return [0, 0, 0];
    let [t] = F;
    t.length === 3 && (t = [...t].map((C2) => C2 + C2).join(""));
    const s = Number.parseInt(t, 16);
    return [s >> 16 & 255, s >> 8 & 255, s & 255];
  }, enumerable: false }, hexToAnsi256: { value: (u2) => r.rgbToAnsi256(...r.hexToRgb(u2)), enumerable: false }, ansi256ToAnsi: { value: (u2) => {
    if (u2 < 8) return 30 + u2;
    if (u2 < 16) return 90 + (u2 - 8);
    let F, t, s;
    if (u2 >= 232) F = ((u2 - 232) * 10 + 8) / 255, t = F, s = F;
    else {
      u2 -= 16;
      const i = u2 % 36;
      F = Math.floor(u2 / 36) / 5, t = Math.floor(i / 6) / 5, s = i % 6 / 5;
    }
    const C2 = Math.max(F, t, s) * 2;
    if (C2 === 0) return 30;
    let D = 30 + (Math.round(s) << 2 | Math.round(t) << 1 | Math.round(F));
    return C2 === 2 && (D += 60), D;
  }, enumerable: false }, rgbToAnsi: { value: (u2, F, t) => r.ansi256ToAnsi(r.rgbToAnsi256(u2, F, t)), enumerable: false }, hexToAnsi: { value: (u2) => r.ansi256ToAnsi(r.hexToAnsi256(u2)), enumerable: false } }), r;
}
var sD = tD();
var g = /* @__PURE__ */ new Set(["\x1B", "\x9B"]);
var CD = 39;
var b = "\x07";
var O = "[";
var iD = "]";
var I = "m";
var w = `${iD}8;;`;
var N = (e2) => `${g.values().next().value}${O}${e2}${I}`;
var L = (e2) => `${g.values().next().value}${w}${e2}${b}`;
var rD = (e2) => e2.split(" ").map((u2) => A(u2));
var y = (e2, u2, F) => {
  const t = [...u2];
  let s = false, C2 = false, D = A(S(e2[e2.length - 1]));
  for (const [i, n] of t.entries()) {
    const E2 = A(n);
    if (D + E2 <= F ? e2[e2.length - 1] += n : (e2.push(n), D = 0), g.has(n) && (s = true, C2 = t.slice(i + 1).join("").startsWith(w)), s) {
      C2 ? n === b && (s = false, C2 = false) : n === I && (s = false);
      continue;
    }
    D += E2, D === F && i < t.length - 1 && (e2.push(""), D = 0);
  }
  !D && e2[e2.length - 1].length > 0 && e2.length > 1 && (e2[e2.length - 2] += e2.pop());
};
var ED = (e2) => {
  const u2 = e2.split(" ");
  let F = u2.length;
  for (; F > 0 && !(A(u2[F - 1]) > 0); ) F--;
  return F === u2.length ? e2 : u2.slice(0, F).join(" ") + u2.slice(F).join("");
};
var oD = (e2, u2, F = {}) => {
  if (F.trim !== false && e2.trim() === "") return "";
  let t = "", s, C2;
  const D = rD(e2);
  let i = [""];
  for (const [E2, h2] of e2.split(" ").entries()) {
    F.trim !== false && (i[i.length - 1] = i[i.length - 1].trimStart());
    let o = A(i[i.length - 1]);
    if (E2 !== 0 && (o >= u2 && (F.wordWrap === false || F.trim === false) && (i.push(""), o = 0), (o > 0 || F.trim === false) && (i[i.length - 1] += " ", o++)), F.hard && D[E2] > u2) {
      const B2 = u2 - o, p = 1 + Math.floor((D[E2] - B2 - 1) / u2);
      Math.floor((D[E2] - 1) / u2) < p && i.push(""), y(i, h2, u2);
      continue;
    }
    if (o + D[E2] > u2 && o > 0 && D[E2] > 0) {
      if (F.wordWrap === false && o < u2) {
        y(i, h2, u2);
        continue;
      }
      i.push("");
    }
    if (o + D[E2] > u2 && F.wordWrap === false) {
      y(i, h2, u2);
      continue;
    }
    i[i.length - 1] += h2;
  }
  F.trim !== false && (i = i.map((E2) => ED(E2)));
  const n = [...i.join(`
`)];
  for (const [E2, h2] of n.entries()) {
    if (t += h2, g.has(h2)) {
      const { groups: B2 } = new RegExp(`(?:\\${O}(?<code>\\d+)m|\\${w}(?<uri>.*)${b})`).exec(n.slice(E2).join("")) || { groups: {} };
      if (B2.code !== void 0) {
        const p = Number.parseFloat(B2.code);
        s = p === CD ? void 0 : p;
      } else B2.uri !== void 0 && (C2 = B2.uri.length === 0 ? void 0 : B2.uri);
    }
    const o = sD.codes.get(Number(s));
    n[E2 + 1] === `
` ? (C2 && (t += L("")), s && o && (t += N(o))) : h2 === `
` && (s && o && (t += N(s)), C2 && (t += L(C2)));
  }
  return t;
};
function R(e2, u2, F) {
  return String(e2).normalize().replace(/\r\n/g, `
`).split(`
`).map((t) => oD(t, u2, F)).join(`
`);
}
var nD = Object.defineProperty;
var aD = (e2, u2, F) => u2 in e2 ? nD(e2, u2, { enumerable: true, configurable: true, writable: true, value: F }) : e2[u2] = F;
var a = (e2, u2, F) => (aD(e2, typeof u2 != "symbol" ? u2 + "" : u2, F), F);
function hD(e2, u2) {
  if (e2 === u2) return;
  const F = e2.split(`
`), t = u2.split(`
`), s = [];
  for (let C2 = 0; C2 < Math.max(F.length, t.length); C2++) F[C2] !== t[C2] && s.push(C2);
  return s;
}
var V = /* @__PURE__ */ Symbol("clack:cancel");
function lD(e2) {
  return e2 === V;
}
function v(e2, u2) {
  e2.isTTY && e2.setRawMode(u2);
}
var z = /* @__PURE__ */ new Map([["k", "up"], ["j", "down"], ["h", "left"], ["l", "right"]]);
var xD = /* @__PURE__ */ new Set(["up", "down", "left", "right", "space", "enter"]);
var x = class {
  constructor({ render: u2, input: F = $, output: t = k, ...s }, C2 = true) {
    a(this, "input"), a(this, "output"), a(this, "rl"), a(this, "opts"), a(this, "_track", false), a(this, "_render"), a(this, "_cursor", 0), a(this, "state", "initial"), a(this, "value"), a(this, "error", ""), a(this, "subscribers", /* @__PURE__ */ new Map()), a(this, "_prevFrame", ""), this.opts = s, this.onKeypress = this.onKeypress.bind(this), this.close = this.close.bind(this), this.render = this.render.bind(this), this._render = u2.bind(this), this._track = C2, this.input = F, this.output = t;
  }
  prompt() {
    const u2 = new U(0);
    return u2._write = (F, t, s) => {
      this._track && (this.value = this.rl.line.replace(/\t/g, ""), this._cursor = this.rl.cursor, this.emit("value", this.value)), s();
    }, this.input.pipe(u2), this.rl = _.createInterface({ input: this.input, output: u2, tabSize: 2, prompt: "", escapeCodeTimeout: 50 }), _.emitKeypressEvents(this.input, this.rl), this.rl.prompt(), this.opts.initialValue !== void 0 && this._track && this.rl.write(this.opts.initialValue), this.input.on("keypress", this.onKeypress), v(this.input, true), this.output.on("resize", this.render), this.render(), new Promise((F, t) => {
      this.once("submit", () => {
        this.output.write(import_sisteransi.cursor.show), this.output.off("resize", this.render), v(this.input, false), F(this.value);
      }), this.once("cancel", () => {
        this.output.write(import_sisteransi.cursor.show), this.output.off("resize", this.render), v(this.input, false), F(V);
      });
    });
  }
  on(u2, F) {
    const t = this.subscribers.get(u2) ?? [];
    t.push({ cb: F }), this.subscribers.set(u2, t);
  }
  once(u2, F) {
    const t = this.subscribers.get(u2) ?? [];
    t.push({ cb: F, once: true }), this.subscribers.set(u2, t);
  }
  emit(u2, ...F) {
    const t = this.subscribers.get(u2) ?? [], s = [];
    for (const C2 of t) C2.cb(...F), C2.once && s.push(() => t.splice(t.indexOf(C2), 1));
    for (const C2 of s) C2();
  }
  unsubscribe() {
    this.subscribers.clear();
  }
  onKeypress(u2, F) {
    if (this.state === "error" && (this.state = "active"), F?.name && !this._track && z.has(F.name) && this.emit("cursor", z.get(F.name)), F?.name && xD.has(F.name) && this.emit("cursor", F.name), u2 && (u2.toLowerCase() === "y" || u2.toLowerCase() === "n") && this.emit("confirm", u2.toLowerCase() === "y"), u2 === "	" && this.opts.placeholder && (this.value || (this.rl.write(this.opts.placeholder), this.emit("value", this.opts.placeholder))), u2 && this.emit("key", u2.toLowerCase()), F?.name === "return") {
      if (this.opts.validate) {
        const t = this.opts.validate(this.value);
        t && (this.error = t, this.state = "error", this.rl.write(this.value));
      }
      this.state !== "error" && (this.state = "submit");
    }
    u2 === "" && (this.state = "cancel"), (this.state === "submit" || this.state === "cancel") && this.emit("finalize"), this.render(), (this.state === "submit" || this.state === "cancel") && this.close();
  }
  close() {
    this.input.unpipe(), this.input.removeListener("keypress", this.onKeypress), this.output.write(`
`), v(this.input, false), this.rl.close(), this.emit(`${this.state}`, this.value), this.unsubscribe();
  }
  restoreCursor() {
    const u2 = R(this._prevFrame, process.stdout.columns, { hard: true }).split(`
`).length - 1;
    this.output.write(import_sisteransi.cursor.move(-999, u2 * -1));
  }
  render() {
    const u2 = R(this._render(this) ?? "", process.stdout.columns, { hard: true });
    if (u2 !== this._prevFrame) {
      if (this.state === "initial") this.output.write(import_sisteransi.cursor.hide);
      else {
        const F = hD(this._prevFrame, u2);
        if (this.restoreCursor(), F && F?.length === 1) {
          const t = F[0];
          this.output.write(import_sisteransi.cursor.move(0, t)), this.output.write(import_sisteransi.erase.lines(1));
          const s = u2.split(`
`);
          this.output.write(s[t]), this._prevFrame = u2, this.output.write(import_sisteransi.cursor.move(0, s.length - t - 1));
          return;
        } else if (F && F?.length > 1) {
          const t = F[0];
          this.output.write(import_sisteransi.cursor.move(0, t)), this.output.write(import_sisteransi.erase.down());
          const s = u2.split(`
`).slice(t);
          this.output.write(s.join(`
`)), this._prevFrame = u2;
          return;
        }
        this.output.write(import_sisteransi.erase.down());
      }
      this.output.write(u2), this.state === "initial" && (this.state = "active"), this._prevFrame = u2;
    }
  }
};
var BD = class extends x {
  get cursor() {
    return this.value ? 0 : 1;
  }
  get _value() {
    return this.cursor === 0;
  }
  constructor(u2) {
    super(u2, false), this.value = !!u2.initialValue, this.on("value", () => {
      this.value = this._value;
    }), this.on("confirm", (F) => {
      this.output.write(import_sisteransi.cursor.move(0, -1)), this.value = F, this.state = "submit", this.close();
    }), this.on("cursor", () => {
      this.value = !this.value;
    });
  }
};
var fD = Object.defineProperty;
var gD = (e2, u2, F) => u2 in e2 ? fD(e2, u2, { enumerable: true, configurable: true, writable: true, value: F }) : e2[u2] = F;
var K = (e2, u2, F) => (gD(e2, typeof u2 != "symbol" ? u2 + "" : u2, F), F);
var vD = class extends x {
  constructor(u2) {
    super(u2, false), K(this, "options"), K(this, "cursor", 0), this.options = u2.options, this.value = [...u2.initialValues ?? []], this.cursor = Math.max(this.options.findIndex(({ value: F }) => F === u2.cursorAt), 0), this.on("key", (F) => {
      F === "a" && this.toggleAll();
    }), this.on("cursor", (F) => {
      switch (F) {
        case "left":
        case "up":
          this.cursor = this.cursor === 0 ? this.options.length - 1 : this.cursor - 1;
          break;
        case "down":
        case "right":
          this.cursor = this.cursor === this.options.length - 1 ? 0 : this.cursor + 1;
          break;
        case "space":
          this.toggleValue();
          break;
      }
    });
  }
  get _value() {
    return this.options[this.cursor].value;
  }
  toggleAll() {
    const u2 = this.value.length === this.options.length;
    this.value = u2 ? [] : this.options.map((F) => F.value);
  }
  toggleValue() {
    const u2 = this.value.includes(this._value);
    this.value = u2 ? this.value.filter((F) => F !== this._value) : [...this.value, this._value];
  }
};
var mD = Object.defineProperty;
var dD = (e2, u2, F) => u2 in e2 ? mD(e2, u2, { enumerable: true, configurable: true, writable: true, value: F }) : e2[u2] = F;
var Y = (e2, u2, F) => (dD(e2, typeof u2 != "symbol" ? u2 + "" : u2, F), F);
var bD = class extends x {
  constructor({ mask: u2, ...F }) {
    super(F), Y(this, "valueWithCursor", ""), Y(this, "_mask", "\u2022"), this._mask = u2 ?? "\u2022", this.on("finalize", () => {
      this.valueWithCursor = this.masked;
    }), this.on("value", () => {
      if (this.cursor >= this.value.length) this.valueWithCursor = `${this.masked}${import_picocolors3.default.inverse(import_picocolors3.default.hidden("_"))}`;
      else {
        const t = this.masked.slice(0, this.cursor), s = this.masked.slice(this.cursor);
        this.valueWithCursor = `${t}${import_picocolors3.default.inverse(s[0])}${s.slice(1)}`;
      }
    });
  }
  get cursor() {
    return this._cursor;
  }
  get masked() {
    return this.value.replaceAll(/./g, this._mask);
  }
};
var wD = Object.defineProperty;
var yD = (e2, u2, F) => u2 in e2 ? wD(e2, u2, { enumerable: true, configurable: true, writable: true, value: F }) : e2[u2] = F;
var Z = (e2, u2, F) => (yD(e2, typeof u2 != "symbol" ? u2 + "" : u2, F), F);
var $D = class extends x {
  constructor(u2) {
    super(u2, false), Z(this, "options"), Z(this, "cursor", 0), this.options = u2.options, this.cursor = this.options.findIndex(({ value: F }) => F === u2.initialValue), this.cursor === -1 && (this.cursor = 0), this.changeValue(), this.on("cursor", (F) => {
      switch (F) {
        case "left":
        case "up":
          this.cursor = this.cursor === 0 ? this.options.length - 1 : this.cursor - 1;
          break;
        case "down":
        case "right":
          this.cursor = this.cursor === this.options.length - 1 ? 0 : this.cursor + 1;
          break;
      }
      this.changeValue();
    });
  }
  get _value() {
    return this.options[this.cursor];
  }
  changeValue() {
    this.value = this._value.value;
  }
};
var TD = Object.defineProperty;
var jD = (e2, u2, F) => u2 in e2 ? TD(e2, u2, { enumerable: true, configurable: true, writable: true, value: F }) : e2[u2] = F;
var MD = (e2, u2, F) => (jD(e2, typeof u2 != "symbol" ? u2 + "" : u2, F), F);
var PD = class extends x {
  constructor(u2) {
    super(u2), MD(this, "valueWithCursor", ""), this.on("finalize", () => {
      this.value || (this.value = u2.defaultValue), this.valueWithCursor = this.value;
    }), this.on("value", () => {
      if (this.cursor >= this.value.length) this.valueWithCursor = `${this.value}${import_picocolors3.default.inverse(import_picocolors3.default.hidden("_"))}`;
      else {
        const F = this.value.slice(0, this.cursor), t = this.value.slice(this.cursor);
        this.valueWithCursor = `${F}${import_picocolors3.default.inverse(t[0])}${t.slice(1)}`;
      }
    });
  }
  get cursor() {
    return this._cursor;
  }
};
var WD = globalThis.process.platform.startsWith("win");
function OD({ input: e2 = $, output: u2 = k, overwrite: F = true, hideCursor: t = true } = {}) {
  const s = f.createInterface({ input: e2, output: u2, prompt: "", tabSize: 1 });
  f.emitKeypressEvents(e2, s), e2.isTTY && e2.setRawMode(true);
  const C2 = (D, { name: i }) => {
    if (String(D) === "") {
      t && u2.write(import_sisteransi.cursor.show), process.exit(0);
      return;
    }
    if (!F) return;
    let n = i === "return" ? 0 : -1, E2 = i === "return" ? -1 : 0;
    f.moveCursor(u2, n, E2, () => {
      f.clearLine(u2, 1, () => {
        e2.once("keypress", C2);
      });
    });
  };
  return t && u2.write(import_sisteransi.cursor.hide), e2.once("keypress", C2), () => {
    e2.off("keypress", C2), t && u2.write(import_sisteransi.cursor.show), e2.isTTY && !WD && e2.setRawMode(false), s.terminal = false, s.close();
  };
}

// node_modules/.pnpm/@clack+prompts@0.8.2/node_modules/@clack/prompts/dist/index.mjs
var import_picocolors4 = __toESM(require_picocolors(), 1);
var import_sisteransi2 = __toESM(require_src(), 1);
import h from "process";
function K2() {
  return h.platform !== "win32" ? h.env.TERM !== "linux" : !!h.env.CI || !!h.env.WT_SESSION || !!h.env.TERMINUS_SUBLIME || h.env.ConEmuTask === "{cmd::Cmder}" || h.env.TERM_PROGRAM === "Terminus-Sublime" || h.env.TERM_PROGRAM === "vscode" || h.env.TERM === "xterm-256color" || h.env.TERM === "alacritty" || h.env.TERMINAL_EMULATOR === "JetBrains-JediTerm";
}
var C = K2();
var u = (s, n) => C ? s : n;
var Y2 = u("\u25C6", "*");
var P2 = u("\u25A0", "x");
var V2 = u("\u25B2", "x");
var M2 = u("\u25C7", "o");
var Q2 = u("\u250C", "T");
var a2 = u("\u2502", "|");
var $2 = u("\u2514", "\u2014");
var I2 = u("\u25CF", ">");
var T2 = u("\u25CB", " ");
var j2 = u("\u25FB", "[\u2022]");
var b2 = u("\u25FC", "[+]");
var B = u("\u25FB", "[ ]");
var X2 = u("\u25AA", "\u2022");
var G = u("\u2500", "-");
var H = u("\u256E", "+");
var ee = u("\u251C", "+");
var te = u("\u256F", "+");
var se = u("\u25CF", "\u2022");
var re = u("\u25C6", "*");
var ie = u("\u25B2", "!");
var ne = u("\u25A0", "x");
var y2 = (s) => {
  switch (s) {
    case "initial":
    case "active":
      return import_picocolors4.default.cyan(Y2);
    case "cancel":
      return import_picocolors4.default.red(P2);
    case "error":
      return import_picocolors4.default.yellow(V2);
    case "submit":
      return import_picocolors4.default.green(M2);
  }
};
var E = (s) => {
  const { cursor: n, options: t, style: i } = s, r2 = s.maxItems ?? 1 / 0, o = Math.max(process.stdout.rows - 4, 0), c2 = Math.min(o, Math.max(r2, 5));
  let l2 = 0;
  n >= l2 + c2 - 3 ? l2 = Math.max(Math.min(n - c2 + 3, t.length - c2), 0) : n < l2 + 2 && (l2 = Math.max(n - 2, 0));
  const d2 = c2 < t.length && l2 > 0, p = c2 < t.length && l2 + c2 < t.length;
  return t.slice(l2, l2 + c2).map((S2, f2, x2) => {
    const g2 = f2 === 0 && d2, m2 = f2 === x2.length - 1 && p;
    return g2 || m2 ? import_picocolors4.default.dim("...") : i(S2, f2 + l2 === n);
  });
};
var ae = (s) => new PD({ validate: s.validate, placeholder: s.placeholder, defaultValue: s.defaultValue, initialValue: s.initialValue, render() {
  const n = `${import_picocolors4.default.gray(a2)}
${y2(this.state)}  ${s.message}
`, t = s.placeholder ? import_picocolors4.default.inverse(s.placeholder[0]) + import_picocolors4.default.dim(s.placeholder.slice(1)) : import_picocolors4.default.inverse(import_picocolors4.default.hidden("_")), i = this.value ? this.valueWithCursor : t;
  switch (this.state) {
    case "error":
      return `${n.trim()}
${import_picocolors4.default.yellow(a2)}  ${i}
${import_picocolors4.default.yellow($2)}  ${import_picocolors4.default.yellow(this.error)}
`;
    case "submit":
      return `${n}${import_picocolors4.default.gray(a2)}  ${import_picocolors4.default.dim(this.value || s.placeholder)}`;
    case "cancel":
      return `${n}${import_picocolors4.default.gray(a2)}  ${import_picocolors4.default.strikethrough(import_picocolors4.default.dim(this.value ?? ""))}${this.value?.trim() ? `
` + import_picocolors4.default.gray(a2) : ""}`;
    default:
      return `${n}${import_picocolors4.default.cyan(a2)}  ${i}
${import_picocolors4.default.cyan($2)}
`;
  }
} }).prompt();
var oe = (s) => new bD({ validate: s.validate, mask: s.mask ?? X2, render() {
  const n = `${import_picocolors4.default.gray(a2)}
${y2(this.state)}  ${s.message}
`, t = this.valueWithCursor, i = this.masked;
  switch (this.state) {
    case "error":
      return `${n.trim()}
${import_picocolors4.default.yellow(a2)}  ${i}
${import_picocolors4.default.yellow($2)}  ${import_picocolors4.default.yellow(this.error)}
`;
    case "submit":
      return `${n}${import_picocolors4.default.gray(a2)}  ${import_picocolors4.default.dim(i)}`;
    case "cancel":
      return `${n}${import_picocolors4.default.gray(a2)}  ${import_picocolors4.default.strikethrough(import_picocolors4.default.dim(i ?? ""))}${i ? `
` + import_picocolors4.default.gray(a2) : ""}`;
    default:
      return `${n}${import_picocolors4.default.cyan(a2)}  ${t}
${import_picocolors4.default.cyan($2)}
`;
  }
} }).prompt();
var ce = (s) => {
  const n = s.active ?? "Yes", t = s.inactive ?? "No";
  return new BD({ active: n, inactive: t, initialValue: s.initialValue ?? true, render() {
    const i = `${import_picocolors4.default.gray(a2)}
${y2(this.state)}  ${s.message}
`, r2 = this.value ? n : t;
    switch (this.state) {
      case "submit":
        return `${i}${import_picocolors4.default.gray(a2)}  ${import_picocolors4.default.dim(r2)}`;
      case "cancel":
        return `${i}${import_picocolors4.default.gray(a2)}  ${import_picocolors4.default.strikethrough(import_picocolors4.default.dim(r2))}
${import_picocolors4.default.gray(a2)}`;
      default:
        return `${i}${import_picocolors4.default.cyan(a2)}  ${this.value ? `${import_picocolors4.default.green(I2)} ${n}` : `${import_picocolors4.default.dim(T2)} ${import_picocolors4.default.dim(n)}`} ${import_picocolors4.default.dim("/")} ${this.value ? `${import_picocolors4.default.dim(T2)} ${import_picocolors4.default.dim(t)}` : `${import_picocolors4.default.green(I2)} ${t}`}
${import_picocolors4.default.cyan($2)}
`;
    }
  } }).prompt();
};
var le = (s) => {
  const n = (t, i) => {
    const r2 = t.label ?? String(t.value);
    switch (i) {
      case "selected":
        return `${import_picocolors4.default.dim(r2)}`;
      case "active":
        return `${import_picocolors4.default.green(I2)} ${r2} ${t.hint ? import_picocolors4.default.dim(`(${t.hint})`) : ""}`;
      case "cancelled":
        return `${import_picocolors4.default.strikethrough(import_picocolors4.default.dim(r2))}`;
      default:
        return `${import_picocolors4.default.dim(T2)} ${import_picocolors4.default.dim(r2)}`;
    }
  };
  return new $D({ options: s.options, initialValue: s.initialValue, render() {
    const t = `${import_picocolors4.default.gray(a2)}
${y2(this.state)}  ${s.message}
`;
    switch (this.state) {
      case "submit":
        return `${t}${import_picocolors4.default.gray(a2)}  ${n(this.options[this.cursor], "selected")}`;
      case "cancel":
        return `${t}${import_picocolors4.default.gray(a2)}  ${n(this.options[this.cursor], "cancelled")}
${import_picocolors4.default.gray(a2)}`;
      default:
        return `${t}${import_picocolors4.default.cyan(a2)}  ${E({ cursor: this.cursor, options: this.options, maxItems: s.maxItems, style: (i, r2) => n(i, r2 ? "active" : "inactive") }).join(`
${import_picocolors4.default.cyan(a2)}  `)}
${import_picocolors4.default.cyan($2)}
`;
    }
  } }).prompt();
};
var $e = (s) => {
  const n = (t, i) => {
    const r2 = t.label ?? String(t.value);
    return i === "active" ? `${import_picocolors4.default.cyan(j2)} ${r2} ${t.hint ? import_picocolors4.default.dim(`(${t.hint})`) : ""}` : i === "selected" ? `${import_picocolors4.default.green(b2)} ${import_picocolors4.default.dim(r2)}` : i === "cancelled" ? `${import_picocolors4.default.strikethrough(import_picocolors4.default.dim(r2))}` : i === "active-selected" ? `${import_picocolors4.default.green(b2)} ${r2} ${t.hint ? import_picocolors4.default.dim(`(${t.hint})`) : ""}` : i === "submitted" ? `${import_picocolors4.default.dim(r2)}` : `${import_picocolors4.default.dim(B)} ${import_picocolors4.default.dim(r2)}`;
  };
  return new vD({ options: s.options, initialValues: s.initialValues, required: s.required ?? true, cursorAt: s.cursorAt, validate(t) {
    if (this.required && t.length === 0) return `Please select at least one option.
${import_picocolors4.default.reset(import_picocolors4.default.dim(`Press ${import_picocolors4.default.gray(import_picocolors4.default.bgWhite(import_picocolors4.default.inverse(" space ")))} to select, ${import_picocolors4.default.gray(import_picocolors4.default.bgWhite(import_picocolors4.default.inverse(" enter ")))} to submit`))}`;
  }, render() {
    let t = `${import_picocolors4.default.gray(a2)}
${y2(this.state)}  ${s.message}
`;
    const i = (r2, o) => {
      const c2 = this.value.includes(r2.value);
      return o && c2 ? n(r2, "active-selected") : c2 ? n(r2, "selected") : n(r2, o ? "active" : "inactive");
    };
    switch (this.state) {
      case "submit":
        return `${t}${import_picocolors4.default.gray(a2)}  ${this.options.filter(({ value: r2 }) => this.value.includes(r2)).map((r2) => n(r2, "submitted")).join(import_picocolors4.default.dim(", ")) || import_picocolors4.default.dim("none")}`;
      case "cancel": {
        const r2 = this.options.filter(({ value: o }) => this.value.includes(o)).map((o) => n(o, "cancelled")).join(import_picocolors4.default.dim(", "));
        return `${t}${import_picocolors4.default.gray(a2)}  ${r2.trim() ? `${r2}
${import_picocolors4.default.gray(a2)}` : ""}`;
      }
      case "error": {
        const r2 = this.error.split(`
`).map((o, c2) => c2 === 0 ? `${import_picocolors4.default.yellow($2)}  ${import_picocolors4.default.yellow(o)}` : `   ${o}`).join(`
`);
        return t + import_picocolors4.default.yellow(a2) + "  " + E({ options: this.options, cursor: this.cursor, maxItems: s.maxItems, style: i }).join(`
${import_picocolors4.default.yellow(a2)}  `) + `
` + r2 + `
`;
      }
      default:
        return `${t}${import_picocolors4.default.cyan(a2)}  ${E({ options: this.options, cursor: this.cursor, maxItems: s.maxItems, style: i }).join(`
${import_picocolors4.default.cyan(a2)}  `)}
${import_picocolors4.default.cyan($2)}
`;
    }
  } }).prompt();
};
var he = (s = "") => {
  process.stdout.write(`${import_picocolors4.default.gray($2)}  ${import_picocolors4.default.red(s)}

`);
};
var pe = (s = "") => {
  process.stdout.write(`${import_picocolors4.default.gray(Q2)}  ${s}
`);
};
var ge = (s = "") => {
  process.stdout.write(`${import_picocolors4.default.gray(a2)}
${import_picocolors4.default.gray($2)}  ${s}

`);
};
var v2 = { message: (s = "", { symbol: n = import_picocolors4.default.gray(a2) } = {}) => {
  const t = [`${import_picocolors4.default.gray(a2)}`];
  if (s) {
    const [i, ...r2] = s.split(`
`);
    t.push(`${n}  ${i}`, ...r2.map((o) => `${import_picocolors4.default.gray(a2)}  ${o}`));
  }
  process.stdout.write(`${t.join(`
`)}
`);
}, info: (s) => {
  v2.message(s, { symbol: import_picocolors4.default.blue(se) });
}, success: (s) => {
  v2.message(s, { symbol: import_picocolors4.default.green(re) });
}, step: (s) => {
  v2.message(s, { symbol: import_picocolors4.default.green(M2) });
}, warn: (s) => {
  v2.message(s, { symbol: import_picocolors4.default.yellow(ie) });
}, warning: (s) => {
  v2.warn(s);
}, error: (s) => {
  v2.message(s, { symbol: import_picocolors4.default.red(ne) });
} };
var _2 = () => {
  const s = C ? ["\u25D2", "\u25D0", "\u25D3", "\u25D1"] : ["\u2022", "o", "O", "0"], n = C ? 80 : 120;
  let t, i, r2 = false, o = "";
  const c2 = (g2) => {
    const m2 = g2 > 1 ? "Something went wrong" : "Canceled";
    r2 && x2(m2, g2);
  }, l2 = () => c2(2), d2 = () => c2(1), p = () => {
    process.on("uncaughtExceptionMonitor", l2), process.on("unhandledRejection", l2), process.on("SIGINT", d2), process.on("SIGTERM", d2), process.on("exit", c2);
  }, S2 = () => {
    process.removeListener("uncaughtExceptionMonitor", l2), process.removeListener("unhandledRejection", l2), process.removeListener("SIGINT", d2), process.removeListener("SIGTERM", d2), process.removeListener("exit", c2);
  }, f2 = (g2 = "") => {
    r2 = true, t = OD(), o = g2.replace(/\.+$/, ""), process.stdout.write(`${import_picocolors4.default.gray(a2)}
`);
    let m2 = 0, w2 = 0;
    p(), i = setInterval(() => {
      const L2 = import_picocolors4.default.magenta(s[m2]), O2 = ".".repeat(Math.floor(w2)).slice(0, 3);
      process.stdout.write(import_sisteransi2.cursor.move(-999, 0)), process.stdout.write(import_sisteransi2.erase.down(1)), process.stdout.write(`${L2}  ${o}${O2}`), m2 = m2 + 1 < s.length ? m2 + 1 : 0, w2 = w2 < s.length ? w2 + 0.125 : 0;
    }, n);
  }, x2 = (g2 = "", m2 = 0) => {
    o = g2 ?? o, r2 = false, clearInterval(i);
    const w2 = m2 === 0 ? import_picocolors4.default.green(M2) : m2 === 1 ? import_picocolors4.default.red(P2) : import_picocolors4.default.red(V2);
    process.stdout.write(import_sisteransi2.cursor.move(-999, 0)), process.stdout.write(import_sisteransi2.erase.down(1)), process.stdout.write(`${w2}  ${o}
`), S2(), t();
  };
  return { start: f2, stop: x2, message: (g2 = "") => {
    o = g2 ?? o;
  } };
};

// src/commands/setup.ts
var import_picocolors7 = __toESM(require_picocolors(), 1);

// src/prompts/prerequisites.ts
var import_picocolors5 = __toESM(require_picocolors(), 1);

// src/services/docker.ts
import { execSync, spawn, spawnSync } from "child_process";
function isDockerInstalled() {
  try {
    execSync("docker --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
function isDockerComposeV2() {
  try {
    const output = execSync("docker compose version", { stdio: "pipe" }).toString();
    return output.includes("v2");
  } catch {
    return false;
  }
}
function isDockerRunning() {
  try {
    execSync("docker info", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
function dockerComposeUp(cwd) {
  execSync("docker compose up -d --pull always", {
    cwd,
    stdio: "inherit"
  });
}
function dockerComposeDown(cwd) {
  execSync("docker compose down", {
    cwd,
    stdio: "inherit"
  });
}
function dockerComposeLogs(cwd) {
  const child = spawn("docker", ["compose", "logs", "--tail", "all", "-f"], {
    cwd,
    stdio: "inherit"
  });
  process.on("SIGINT", () => {
    child.kill("SIGINT");
  });
  child.on("exit", () => process.exit(0));
}
function dockerLogsMulti(containerNames) {
  const children = containerNames.map(
    (name) => spawn("docker", ["logs", "--tail", "all", "-f", "--timestamps", name], {
      stdio: ["ignore", "inherit", "inherit"]
    })
  );
  process.on("SIGINT", () => {
    for (const child of children) child.kill("SIGINT");
  });
  let exited = 0;
  for (const child of children) {
    child.on("exit", () => {
      exited++;
      if (exited === children.length) process.exit(0);
    });
  }
}
function dockerExecToFile(containerName, command, outputPath) {
  execSync(`docker exec ${containerName} ${command} > "${outputPath}"`, {
    stdio: "pipe",
    shell: "/bin/sh",
    maxBuffer: 1024 * 1024 * 512
  });
}
function dockerExecFromFile(containerName, command, inputPath) {
  execSync(`docker exec -i ${containerName} ${command} < "${inputPath}"`, {
    stdio: "pipe",
    shell: "/bin/sh",
    maxBuffer: 1024 * 1024 * 512
  });
}
function isContainerRunning(containerName) {
  try {
    const output = execSync(
      `docker inspect -f '{{.State.Running}}' ${containerName}`,
      { stdio: "pipe" }
    ).toString().trim();
    return output === "true";
  } catch {
    return false;
  }
}
function dockerStats(cwd) {
  return execSync(
    'docker compose stats --no-stream --format "table {{.Name}}	{{.CPUPerc}}	{{.MemUsage}}	{{.MemPerc}}	{{.NetIO}}"',
    { cwd, stdio: "pipe" }
  ).toString();
}
function dockerStatsForContainers(containerNames) {
  if (containerNames.length === 0) return "";
  return execSync(
    `docker stats --no-stream --format "table {{.Name}}	{{.CPUPerc}}	{{.MemUsage}}	{{.MemPerc}}	{{.NetIO}}" ${containerNames.join(" ")}`,
    { stdio: "pipe" }
  ).toString();
}
function getContainerLogs(containerName, lines = 50) {
  return execSync(`docker logs --tail ${lines} ${containerName}`, {
    stdio: "pipe"
  }).toString();
}
function getDockerDiskUsage() {
  return execSync("docker system df", { stdio: "pipe" }).toString();
}
function autoDetectDeploymentId() {
  try {
    const output = execSync(
      'docker ps -a --filter "name=learnhouse-app-" --format "{{.Names}}"',
      { stdio: "pipe" }
    ).toString().trim();
    if (!output) return null;
    const match = output.split("\n")[0].match(/learnhouse-app-([a-f0-9]+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
function listDeploymentContainers(deploymentId) {
  try {
    const id = deploymentId || autoDetectDeploymentId();
    if (!id) return [];
    const output = execSync(
      `docker ps -a --filter "name=learnhouse-" --format "{{.Names}}\\t{{.Status}}\\t{{.Image}}"`,
      { stdio: "pipe" }
    ).toString().trim();
    if (!output) return [];
    return output.split("\n").filter((line) => line.includes(id)).map((line) => {
      const [name, status, image] = line.split("	");
      return { name, status, image };
    });
  } catch {
    return [];
  }
}
function getContainerRestartCount(containerName) {
  try {
    const output = execSync(
      `docker inspect -f '{{.RestartCount}}' ${containerName}`,
      { stdio: "pipe" }
    ).toString().trim();
    return parseInt(output, 10) || 0;
  } catch {
    return 0;
  }
}
function dockerExecInteractive(containerName, cmd) {
  const result = spawnSync("docker", ["exec", "-it", containerName, ...cmd.split(" ")], {
    stdio: "inherit"
  });
  if (result.status !== null) {
    process.exitCode = result.status;
  }
}

// src/prompts/prerequisites.ts
async function checkPrerequisites() {
  const s = _2();
  s.start("Checking prerequisites");
  const checks = [
    {
      name: "Docker Engine",
      check: isDockerInstalled,
      failMsg: `Docker is not installed. Install it from ${import_picocolors5.default.underline("https://docs.docker.com/get-docker/")}`
    },
    {
      name: "Docker Compose v2",
      check: isDockerComposeV2,
      failMsg: `Docker Compose v2 is required. Install it from ${import_picocolors5.default.underline("https://docs.docker.com/compose/install/")}`
    },
    {
      name: "Docker daemon",
      check: isDockerRunning,
      failMsg: "Docker daemon is not running. Please start Docker and try again."
    }
  ];
  const failed = [];
  for (const { name, check, failMsg } of checks) {
    if (!check()) {
      failed.push(`${import_picocolors5.default.red("x")} ${name}: ${failMsg}`);
    }
  }
  if (failed.length > 0) {
    s.stop("Prerequisites check failed");
    v2.error("Missing prerequisites:");
    for (const msg of failed) {
      v2.message(msg);
    }
    he("Please install the missing prerequisites and try again.");
    process.exit(1);
  }
  s.stop("All prerequisites met");
}

// src/utils/validators.ts
function validateEmail(value) {
  if (!value) return "Email is required";
  const re2 = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re2.test(value)) return "Please enter a valid email address";
  return void 0;
}
function validatePassword(value) {
  if (!value) return "Password is required";
  if (value.length < 8) return "Password must be at least 8 characters";
  return void 0;
}
function validateDomain(value) {
  if (!value) return "Domain is required";
  if (value === "localhost") return void 0;
  const re2 = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
  if (!re2.test(value)) return "Please enter a valid domain (e.g., learnhouse.example.com)";
  return void 0;
}
function validatePort(value) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 1 || num > 65535) return "Port must be between 1 and 65535";
  return void 0;
}
function validateRequired(value) {
  if (!value || value.trim() === "") return "This field is required";
  return void 0;
}

// src/prompts/domain.ts
async function promptDomain() {
  const domain = await ae({
    message: "What domain will LearnHouse be hosted on?",
    placeholder: "localhost",
    defaultValue: "localhost",
    validate: validateDomain
  });
  if (lD(domain)) {
    he();
    process.exit(0);
  }
  let useHttps = false;
  let autoSsl = false;
  let sslEmail;
  if (domain !== "localhost") {
    const httpsChoice = await le({
      message: "HTTPS configuration?",
      options: [
        { value: "auto", label: "Automatic SSL (Let's Encrypt via Caddy)", hint: "recommended" },
        { value: "manual", label: "I'll handle SSL myself (reverse proxy, Cloudflare, etc.)" },
        { value: "none", label: "No HTTPS (HTTP only)", hint: "not recommended for production" }
      ]
    });
    if (lD(httpsChoice)) {
      he();
      process.exit(0);
    }
    if (httpsChoice === "auto") {
      useHttps = true;
      autoSsl = true;
      const email = await ae({
        message: "Email for Let's Encrypt notifications?",
        placeholder: "admin@example.com",
        validate: validateEmail
      });
      if (lD(email)) {
        he();
        process.exit(0);
      }
      sslEmail = email;
    } else if (httpsChoice === "manual") {
      useHttps = true;
    }
  }
  const defaultPort = autoSsl ? 443 : 80;
  const portMessage = autoSsl ? "HTTPS port? (Caddy needs 443 for auto SSL, and will also listen on 80 for redirect)" : "HTTP port for the web server?";
  const port = await ae({
    message: portMessage,
    placeholder: String(defaultPort),
    defaultValue: String(defaultPort),
    validate: validatePort
  });
  if (lD(port)) {
    he();
    process.exit(0);
  }
  return {
    domain,
    useHttps,
    httpPort: parseInt(port, 10),
    autoSsl,
    sslEmail
  };
}

// src/prompts/database.ts
import crypto from "crypto";
var import_picocolors6 = __toESM(require_picocolors(), 1);

// src/utils/network.ts
import net from "net";
function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}
function checkTcpConnection(host, port, timeoutMs = 5e3) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}
function parsePostgresUrl(connString) {
  try {
    const url = new URL(connString);
    return { host: url.hostname, port: url.port ? parseInt(url.port, 10) : 5432 };
  } catch {
    return null;
  }
}
function parseRedisUrl(connString) {
  try {
    const url = new URL(connString);
    return { host: url.hostname, port: url.port ? parseInt(url.port, 10) : 6379 };
  } catch {
    return null;
  }
}

// src/prompts/database.ts
async function promptAndVerifyPostgres() {
  while (true) {
    const connString = await ae({
      message: "PostgreSQL connection string?",
      placeholder: "postgresql://user:password@host:5432/learnhouse",
      validate: (value) => {
        const err = validateRequired(value);
        if (err) return err;
        if (!value.startsWith("postgresql://") && !value.startsWith("postgres://")) {
          return "Must start with postgresql:// or postgres://";
        }
        return void 0;
      }
    });
    if (lD(connString)) {
      he();
      process.exit(0);
    }
    const parsed = parsePostgresUrl(connString);
    if (!parsed) {
      v2.error("Could not parse the connection string. Please check the format.");
      continue;
    }
    const s = _2();
    s.start(`Checking connection to ${parsed.host}:${parsed.port}`);
    const reachable = await checkTcpConnection(parsed.host, parsed.port);
    if (reachable) {
      s.stop(`${import_picocolors6.default.green("Connected")} to ${parsed.host}:${parsed.port}`);
      return connString;
    }
    s.stop(`${import_picocolors6.default.red("Connection failed")} to ${parsed.host}:${parsed.port}`);
    const retry = await ce({
      message: "Could not reach the database. Try a different connection string?",
      initialValue: true
    });
    if (lD(retry) || !retry) {
      he();
      process.exit(0);
    }
  }
}
async function promptAndVerifyRedis() {
  while (true) {
    const connString = await ae({
      message: "Redis connection string?",
      placeholder: "redis://user:password@host:6379/0",
      validate: (value) => {
        const err = validateRequired(value);
        if (err) return err;
        if (!value.startsWith("redis://") && !value.startsWith("rediss://")) {
          return "Must start with redis:// or rediss://";
        }
        return void 0;
      }
    });
    if (lD(connString)) {
      he();
      process.exit(0);
    }
    const parsed = parseRedisUrl(connString);
    if (!parsed) {
      v2.error("Could not parse the connection string. Please check the format.");
      continue;
    }
    const s = _2();
    s.start(`Checking connection to ${parsed.host}:${parsed.port}`);
    const reachable = await checkTcpConnection(parsed.host, parsed.port);
    if (reachable) {
      s.stop(`${import_picocolors6.default.green("Connected")} to ${parsed.host}:${parsed.port}`);
      return connString;
    }
    s.stop(`${import_picocolors6.default.red("Connection failed")} to ${parsed.host}:${parsed.port}`);
    const retry = await ce({
      message: "Could not reach Redis. Try a different connection string?",
      initialValue: true
    });
    if (lD(retry) || !retry) {
      he();
      process.exit(0);
    }
  }
}
async function promptDatabase() {
  const dbChoice = await le({
    message: "PostgreSQL database setup?",
    options: [
      { value: "local", label: "Create a new database (Docker)", hint: "recommended" },
      { value: "external", label: "Use an external database", hint: "bring your own PostgreSQL" }
    ]
  });
  if (lD(dbChoice)) {
    he();
    process.exit(0);
  }
  let useExternalDb = false;
  let externalDbConnectionString;
  let dbPassword;
  let useAiDatabase = false;
  if (dbChoice === "external") {
    externalDbConnectionString = await promptAndVerifyPostgres();
    useExternalDb = true;
  } else {
    const dbImageChoice = await le({
      message: "Which PostgreSQL image?",
      options: [
        { value: "ai", label: "PostgreSQL with AI capabilities", hint: "recommended \u2014 enables AI course chatbot (RAG)" },
        { value: "standard", label: "Standard PostgreSQL", hint: "lighter image, no AI search features" }
      ]
    });
    if (lD(dbImageChoice)) {
      he();
      process.exit(0);
    }
    useAiDatabase = dbImageChoice === "ai";
    dbPassword = crypto.randomBytes(24).toString("base64url");
    v2.message("");
    v2.info(import_picocolors6.default.bold("Database credentials generated:"));
    v2.message([
      "",
      `  ${import_picocolors6.default.dim("User:")}     learnhouse`,
      `  ${import_picocolors6.default.dim("Password:")} ${import_picocolors6.default.cyan(dbPassword)}`,
      `  ${import_picocolors6.default.dim("Database:")} learnhouse`,
      `  ${import_picocolors6.default.dim("Host:")}     db:5432 (internal)`,
      "",
      `  ${import_picocolors6.default.yellow("Copy the password now if needed \u2014 it will be saved in .env")}`,
      ""
    ].join("\n"));
    const ack = await ce({ message: "Continue?", initialValue: true });
    if (lD(ack) || !ack) {
      he();
      process.exit(0);
    }
  }
  const redisChoice = await le({
    message: "Redis setup?",
    options: [
      { value: "local", label: "Create a new Redis instance (Docker)", hint: "recommended" },
      { value: "external", label: "Use an external Redis", hint: "bring your own Redis" }
    ]
  });
  if (lD(redisChoice)) {
    he();
    process.exit(0);
  }
  let useExternalRedis = false;
  let externalRedisConnectionString;
  if (redisChoice === "external") {
    externalRedisConnectionString = await promptAndVerifyRedis();
    useExternalRedis = true;
  }
  return {
    useExternalDb,
    externalDbConnectionString,
    dbPassword,
    useAiDatabase,
    useExternalRedis,
    externalRedisConnectionString
  };
}

// src/prompts/organization.ts
async function promptOrganization() {
  const orgName = await ae({
    message: "Organization name?",
    placeholder: "My School",
    validate: validateRequired
  });
  if (lD(orgName)) {
    he();
    process.exit(0);
  }
  return {
    orgName
  };
}

// src/prompts/admin.ts
async function promptAdmin() {
  const email = await ae({
    message: "Admin email address?",
    placeholder: "admin@example.com",
    validate: validateEmail
  });
  if (lD(email)) {
    he();
    process.exit(0);
  }
  const password = await oe({
    message: "Admin password? (min 8 characters)",
    validate: validatePassword
  });
  if (lD(password)) {
    he();
    process.exit(0);
  }
  return {
    adminEmail: email,
    adminPassword: password
  };
}

// src/prompts/features.ts
async function promptFeatures() {
  const selected = await $e({
    message: "Enable optional features? (Space to toggle, Enter to confirm)",
    options: [
      { value: "ai", label: "AI Features (Gemini)" },
      { value: "email", label: "Email (Resend or SMTP)" },
      { value: "s3", label: "S3 Storage" },
      { value: "google", label: "Google OAuth" },
      { value: "unsplash", label: "Unsplash Images" }
    ],
    required: false
  });
  if (lD(selected)) {
    he();
    process.exit(0);
  }
  const features = selected;
  const config = {
    aiEnabled: features.includes("ai"),
    emailEnabled: features.includes("email"),
    s3Enabled: features.includes("s3"),
    googleOAuthEnabled: features.includes("google"),
    unsplashEnabled: features.includes("unsplash")
  };
  if (config.aiEnabled) {
    v2.info("Configure AI (Gemini)");
    const key = await ae({
      message: "Gemini API key?",
      placeholder: "AIza...",
      validate: validateRequired
    });
    if (lD(key)) {
      he();
      process.exit(0);
    }
    config.geminiApiKey = key;
  }
  if (config.emailEnabled) {
    const provider = await le({
      message: "Email provider?",
      options: [
        { value: "smtp", label: "SMTP (any provider)" },
        { value: "resend", label: "Resend" }
      ]
    });
    if (lD(provider)) {
      he();
      process.exit(0);
    }
    config.emailProvider = provider;
    if (config.emailProvider === "resend") {
      v2.info("Configure Email (Resend)");
      const key = await ae({
        message: "Resend API key?",
        placeholder: "re_...",
        validate: validateRequired
      });
      if (lD(key)) {
        he();
        process.exit(0);
      }
      config.resendApiKey = key;
    } else {
      v2.info("Configure Email (SMTP)");
      const host = await ae({
        message: "SMTP host?",
        placeholder: "smtp.gmail.com",
        validate: validateRequired
      });
      if (lD(host)) {
        he();
        process.exit(0);
      }
      config.smtpHost = host;
      const port = await ae({
        message: "SMTP port?",
        initialValue: "587",
        validate: validateRequired
      });
      if (lD(port)) {
        he();
        process.exit(0);
      }
      config.smtpPort = parseInt(port, 10);
      const username = await ae({
        message: "SMTP username?",
        validate: validateRequired
      });
      if (lD(username)) {
        he();
        process.exit(0);
      }
      config.smtpUsername = username;
      const password = await oe({
        message: "SMTP password?",
        validate: validateRequired
      });
      if (lD(password)) {
        he();
        process.exit(0);
      }
      config.smtpPassword = password;
      const useTls = await ce({
        message: "Use TLS?",
        initialValue: true
      });
      if (lD(useTls)) {
        he();
        process.exit(0);
      }
      config.smtpUseTls = useTls;
    }
    const email = await ae({
      message: "System email address (From)?",
      placeholder: "noreply@yourdomain.com",
      validate: validateRequired
    });
    if (lD(email)) {
      he();
      process.exit(0);
    }
    config.systemEmailAddress = email;
  }
  if (config.s3Enabled) {
    v2.info("Configure S3 Storage");
    const bucket = await ae({
      message: "S3 bucket name?",
      validate: validateRequired
    });
    if (lD(bucket)) {
      he();
      process.exit(0);
    }
    config.s3BucketName = bucket;
    const endpoint = await ae({
      message: "S3 endpoint URL? (leave empty for AWS S3)",
      placeholder: "https://s3.amazonaws.com"
    });
    if (lD(endpoint)) {
      he();
      process.exit(0);
    }
    if (endpoint) config.s3EndpointUrl = endpoint;
  }
  if (config.googleOAuthEnabled) {
    v2.info("Configure Google OAuth");
    const clientId = await ae({
      message: "Google Client ID?",
      validate: validateRequired
    });
    if (lD(clientId)) {
      he();
      process.exit(0);
    }
    config.googleClientId = clientId;
    const clientSecret = await ae({
      message: "Google Client Secret?",
      validate: validateRequired
    });
    if (lD(clientSecret)) {
      he();
      process.exit(0);
    }
    config.googleClientSecret = clientSecret;
  }
  if (config.unsplashEnabled) {
    v2.info("Configure Unsplash");
    const key = await ae({
      message: "Unsplash Access Key?",
      validate: validateRequired
    });
    if (lD(key)) {
      he();
      process.exit(0);
    }
    config.unsplashAccessKey = key;
  }
  return config;
}

// src/templates/docker-compose.ts
function generateDockerCompose(config, appImage) {
  const image = appImage || APP_IMAGE;
  const id = config.deploymentId;
  const useLocalDb = !config.useExternalDb;
  const useLocalRedis = !config.useExternalRedis;
  const deps = [];
  if (useLocalDb) deps.push("      db:\n        condition: service_healthy");
  if (useLocalRedis) deps.push("      redis:\n        condition: service_healthy");
  const appDependsOn = deps.length > 0 ? `    depends_on:
${deps.join("\n")}` : "";
  const proxyService = config.autoSsl ? `
  caddy:
    image: caddy:2-alpine
    container_name: learnhouse-caddy-${id}
    restart: unless-stopped
    ports:
      - "80:80"
      - "\${HTTP_PORT:-443}:443"
    volumes:
      - ./extra/Caddyfile:/etc/caddy/Caddyfile:ro
      - learnhouse_caddy_data_${id}:/data
      - learnhouse_caddy_config_${id}:/config
    depends_on:
      learnhouse-app:
        condition: service_healthy
    networks:
      - learnhouse-network-${id}
    healthcheck:
      test: ["CMD-SHELL", "wget --quiet --tries=1 --spider http://localhost:80/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
` : `
  nginx:
    image: nginx:alpine
    container_name: learnhouse-nginx-${id}
    restart: unless-stopped
    ports:
      - "\${HTTP_PORT:-80}:80"
    volumes:
      - ./extra/nginx.prod.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      learnhouse-app:
        condition: service_healthy
    networks:
      - learnhouse-network-${id}
    healthcheck:
      test: ["CMD-SHELL", "wget --quiet --tries=1 --spider http://localhost/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
`;
  const dbImage = config.useAiDatabase ? POSTGRES_AI_IMAGE : POSTGRES_IMAGE;
  const dbService = useLocalDb ? `
  db:
    image: ${dbImage}
    container_name: learnhouse-db-${id}
    restart: unless-stopped
    env_file:
      - .env
    environment:
      - POSTGRES_USER=\${POSTGRES_USER:-learnhouse}
      - POSTGRES_PASSWORD=\${POSTGRES_PASSWORD:-learnhouse}
      - POSTGRES_DB=\${POSTGRES_DB:-learnhouse}
    volumes:
      - learnhouse_db_data_${id}:/var/lib/postgresql/data
    networks:
      - learnhouse-network-${id}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-learnhouse}"]
      interval: 5s
      timeout: 4s
      retries: 5
` : "";
  const redisService = useLocalRedis ? `
  redis:
    image: redis:7.2.3-alpine
    container_name: learnhouse-redis-${id}
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - learnhouse_redis_data_${id}:/data
    networks:
      - learnhouse-network-${id}
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 4s
      retries: 5
` : "";
  const volumeEntries = [];
  if (config.autoSsl) {
    volumeEntries.push(`  learnhouse_caddy_data_${id}:`);
    volumeEntries.push(`  learnhouse_caddy_config_${id}:`);
  }
  if (useLocalDb) volumeEntries.push(`  learnhouse_db_data_${id}:`);
  if (useLocalRedis) volumeEntries.push(`  learnhouse_redis_data_${id}:`);
  const volumesSection = volumeEntries.length > 0 ? `volumes:
${volumeEntries.join("\n")}` : "";
  return `name: learnhouse-${id}

services:
  learnhouse-app:
    image: ${image}
    container_name: learnhouse-app-${id}
    restart: unless-stopped
    env_file:
      - .env
    environment:
      # HOSTNAME needs to be set explicitly for the container
      - HOSTNAME=0.0.0.0
${appDependsOn}
    networks:
      - learnhouse-network-${id}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/api/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
${proxyService}${dbService}${redisService}
networks:
  learnhouse-network-${id}:
    driver: bridge

${volumesSection}
`;
}

// src/templates/env.ts
import crypto2 from "crypto";
function generateSecret() {
  return crypto2.randomBytes(32).toString("base64");
}
function generateEnvFile(config) {
  const protocol = config.useHttps ? "https" : "http";
  const portSuffix = config.useHttps && config.httpPort === 443 || !config.useHttps && config.httpPort === 80 ? "" : `:${config.httpPort}`;
  const baseUrl = `${protocol}://${config.domain}${portSuffix}`;
  const domainWithPort = `${config.domain}${portSuffix}`;
  const topDomain = config.domain === "localhost" ? "localhost" : config.domain.split(".").slice(-2).join(".");
  const cookieDomain = config.domain === "localhost" ? ".localhost" : `.${topDomain}`;
  const nextAuthSecret = generateSecret();
  const jwtSecret = generateSecret();
  const lines = [
    "# LearnHouse Environment Variables",
    "# Generated by LearnHouse CLI",
    "",
    "# =============================================================================",
    "# Domain & Hosting Configuration",
    "# =============================================================================",
    "",
    `LEARNHOUSE_DOMAIN=${domainWithPort}`,
    `HTTP_PORT=${config.httpPort}`,
    "",
    "# =============================================================================",
    "# Frontend Environment Variables (NEXT_PUBLIC_*)",
    "# =============================================================================",
    "",
    `NEXT_PUBLIC_LEARNHOUSE_API_URL=${baseUrl}/api/v1/`,
    `NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL=${baseUrl}/`,
    `NEXT_PUBLIC_LEARNHOUSE_DOMAIN=${domainWithPort}`,
    `NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN=${topDomain}`,
    "NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG=False",
    "NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG=default",
    `NEXT_PUBLIC_LEARNHOUSE_HTTPS=${config.useHttps ? "True" : "False"}`
  ];
  if (config.unsplashEnabled && config.unsplashAccessKey) {
    lines.push(`NEXT_PUBLIC_UNSPLASH_ACCESS_KEY=${config.unsplashAccessKey}`);
  }
  lines.push(
    "",
    "# =============================================================================",
    "# NextAuth Configuration",
    "# =============================================================================",
    "",
    `NEXTAUTH_URL=${baseUrl}`,
    `NEXTAUTH_SECRET=${nextAuthSecret}`
  );
  if (config.googleOAuthEnabled && config.googleClientId && config.googleClientSecret) {
    lines.push(
      `LEARNHOUSE_GOOGLE_CLIENT_ID=${config.googleClientId}`,
      `LEARNHOUSE_GOOGLE_CLIENT_SECRET=${config.googleClientSecret}`
    );
  }
  lines.push(
    "",
    "# =============================================================================",
    "# Backend Configuration",
    "# =============================================================================",
    "",
    `LEARNHOUSE_SQL_CONNECTION_STRING=${config.useExternalDb ? config.externalDbConnectionString : `postgresql://learnhouse:${config.dbPassword}@db:5432/learnhouse`}`,
    `LEARNHOUSE_REDIS_CONNECTION_STRING=${config.useExternalRedis ? config.externalRedisConnectionString : "redis://redis:6379/learnhouse"}`,
    `LEARNHOUSE_COOKIE_DOMAIN=${cookieDomain}`,
    "LEARNHOUSE_PORT=9000",
    "",
    "# =============================================================================",
    "# Security",
    "# =============================================================================",
    "",
    `LEARNHOUSE_AUTH_JWT_SECRET_KEY=${jwtSecret}`,
    `LEARNHOUSE_INITIAL_ADMIN_EMAIL=${config.adminEmail}`,
    `LEARNHOUSE_INITIAL_ADMIN_PASSWORD=${config.adminPassword}`,
    "",
    "# =============================================================================",
    "# General Settings",
    "# =============================================================================",
    "",
    "LEARNHOUSE_DEVELOPMENT_MODE=False",
    "LEARNHOUSE_LOGFIRE_ENABLED=False",
    "LEARNHOUSE_OSS=True",
    "NEXT_PUBLIC_LEARNHOUSE_OSS=True"
  );
  if (config.aiEnabled && config.geminiApiKey) {
    lines.push(
      "",
      "# =============================================================================",
      "# AI Configuration",
      "# =============================================================================",
      "",
      `LEARNHOUSE_GEMINI_API_KEY=${config.geminiApiKey}`,
      "LEARNHOUSE_IS_AI_ENABLED=True"
    );
  } else {
    lines.push(
      "",
      "# =============================================================================",
      "# AI Configuration",
      "# =============================================================================",
      "",
      "LEARNHOUSE_IS_AI_ENABLED=False"
    );
  }
  if (config.emailEnabled) {
    const provider = config.emailProvider || "resend";
    lines.push(
      "",
      "# =============================================================================",
      "# Email Configuration",
      "# =============================================================================",
      "",
      `LEARNHOUSE_EMAIL_PROVIDER=${provider}`,
      `LEARNHOUSE_SYSTEM_EMAIL_ADDRESS=${config.systemEmailAddress || `noreply@${config.domain}`}`
    );
    if (provider === "resend" && config.resendApiKey) {
      lines.push(`LEARNHOUSE_RESEND_API_KEY=${config.resendApiKey}`);
    }
    if (provider === "smtp") {
      if (config.smtpHost) lines.push(`LEARNHOUSE_SMTP_HOST=${config.smtpHost}`);
      lines.push(`LEARNHOUSE_SMTP_PORT=${config.smtpPort || 587}`);
      if (config.smtpUsername) lines.push(`LEARNHOUSE_SMTP_USERNAME=${config.smtpUsername}`);
      if (config.smtpPassword) lines.push(`LEARNHOUSE_SMTP_PASSWORD=${config.smtpPassword}`);
      lines.push(`LEARNHOUSE_SMTP_USE_TLS=${config.smtpUseTls !== false ? "True" : "False"}`);
    }
  }
  if (config.s3Enabled && config.s3BucketName) {
    lines.push(
      "",
      "# =============================================================================",
      "# Content Delivery",
      "# =============================================================================",
      "",
      "LEARNHOUSE_CONTENT_DELIVERY_TYPE=s3api",
      `LEARNHOUSE_S3_API_BUCKET_NAME=${config.s3BucketName}`
    );
    if (config.s3EndpointUrl) {
      lines.push(`LEARNHOUSE_S3_API_ENDPOINT_URL=${config.s3EndpointUrl}`);
    }
  } else {
    lines.push(
      "",
      "# =============================================================================",
      "# Content Delivery",
      "# =============================================================================",
      "",
      "LEARNHOUSE_CONTENT_DELIVERY_TYPE=filesystem"
    );
  }
  if (!config.useExternalDb) {
    lines.push(
      "",
      "# =============================================================================",
      "# Database Configuration",
      "# =============================================================================",
      "",
      "POSTGRES_USER=learnhouse",
      `POSTGRES_PASSWORD=${config.dbPassword}`,
      "POSTGRES_DB=learnhouse",
      ""
    );
  } else {
    lines.push("");
  }
  return lines.join("\n");
}

// src/templates/nginx.ts
function generateNginxConf() {
  return `
server {
    listen 80;
    server_name _;
    client_max_body_size 500M;

    # Increase header buffer size
    large_client_header_buffers 4 32k;

    # Increase the maximum allowed size of the client request body
    client_body_buffer_size 32k;

    # Increase the maximum allowed size of the client request header fields
    client_header_buffer_size 32k;

    # Proxy all requests to the learnhouse-app service
    # The app container has internal nginx routing between frontend and backend
    location / {
        proxy_pass http://learnhouse-app:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Timeouts for long-running requests
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
`;
}

// src/templates/caddyfile.ts
function generateCaddyfile(config) {
  const email = config.sslEmail || "admin@example.com";
  return `{
  email ${email}
}

${config.domain} {
  reverse_proxy learnhouse-app:3000
}
`;
}

// src/services/config-store.ts
import fs from "fs";
import path from "path";
function writeConfig(config) {
  const data = {
    version: VERSION,
    deploymentId: config.deploymentId,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    installDir: config.installDir,
    domain: config.domain,
    httpPort: config.httpPort,
    useHttps: config.useHttps,
    autoSsl: config.autoSsl,
    useExternalDb: config.useExternalDb,
    orgSlug: "default"
  };
  fs.writeFileSync(
    path.join(config.installDir, CONFIG_FILENAME),
    JSON.stringify(data, null, 2) + "\n"
  );
}
function readConfig(dir) {
  const configPath = path.join(dir || process.cwd(), CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return null;
  }
}
function isCompleteInstall(dir) {
  const configPath = path.join(dir, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) return false;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return !!config.deploymentId && fs.existsSync(path.join(dir, ".env"));
  } catch {
    return false;
  }
}
function collectCandidates(dir, depth, results) {
  if (depth < 0) return;
  if (fs.existsSync(path.join(dir, CONFIG_FILENAME))) {
    results.push(dir);
  }
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "backups") continue;
      collectCandidates(path.join(dir, entry.name), depth - 1, results);
    }
  } catch {
  }
}
function pickBest(candidates) {
  if (candidates.length === 0) return null;
  const complete = candidates.find(isCompleteInstall);
  if (complete) return complete;
  return candidates[0];
}
function findInstallDir() {
  const cwd = process.cwd();
  if (isCompleteInstall(cwd)) return cwd;
  const subDir = path.join(cwd, "learnhouse");
  if (isCompleteInstall(subDir)) return subDir;
  const candidates = [];
  collectCandidates(cwd, 10, candidates);
  const best = pickBest(candidates);
  if (best) return best;
  let current = cwd;
  while (true) {
    const parent = path.dirname(current);
    if (parent === current) break;
    if (isCompleteInstall(parent)) return parent;
    const parentSub = path.join(parent, "learnhouse");
    if (isCompleteInstall(parentSub)) return parentSub;
    if (fs.existsSync(path.join(parent, CONFIG_FILENAME))) return parent;
    current = parent;
  }
  return cwd;
}

// src/services/health.ts
async function waitForHealth(baseUrl) {
  const url = `${baseUrl}/api/v1/health`;
  const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5e3) });
      if (res.ok) return true;
    } catch {
    }
    await new Promise((r2) => setTimeout(r2, HEALTH_CHECK_INTERVAL_MS));
  }
  return false;
}

// src/commands/setup.ts
var STEP_NAMES = [
  "Install Directory",
  "Domain Configuration",
  "Database & Redis",
  "Organization Setup",
  "Admin Account",
  "Optional Features"
];
var BACK = /* @__PURE__ */ Symbol("back");
async function confirmOrBack(message) {
  if (STEP_NAMES.length === 0) return true;
  const result = await le({
    message,
    options: [
      { value: "continue", label: "Continue" },
      { value: "back", label: import_picocolors7.default.dim("Go back to previous step") }
    ]
  });
  if (lD(result)) {
    he();
    process.exit(0);
  }
  return result === "back" ? BACK : true;
}
async function stepInstallDir() {
  const installDir = await ae({
    message: "Where should LearnHouse be installed?",
    placeholder: "./learnhouse",
    defaultValue: "./learnhouse"
  });
  if (lD(installDir)) {
    he();
    process.exit(0);
  }
  return path2.resolve(installDir);
}
async function stepDomain() {
  v2.step(import_picocolors7.default.cyan(`Step 2/6`) + " Domain Configuration");
  const config = await promptDomain();
  const portAvailable = await checkPort(config.httpPort);
  if (!portAvailable) {
    v2.warn(`Port ${config.httpPort} is already in use. You may need to free it before starting.`);
  }
  return config;
}
async function stepDatabase() {
  v2.step(import_picocolors7.default.cyan(`Step 3/6`) + " Database & Redis");
  return await promptDatabase();
}
async function stepOrganization() {
  v2.step(import_picocolors7.default.cyan(`Step 4/6`) + " Organization Setup");
  return await promptOrganization();
}
async function stepAdmin() {
  v2.step(import_picocolors7.default.cyan(`Step 5/6`) + " Admin Account");
  return await promptAdmin();
}
async function stepFeatures() {
  v2.step(import_picocolors7.default.cyan(`Step 6/6`) + " Optional Features");
  return await promptFeatures();
}
async function setupCommand() {
  await printBanner();
  pe(import_picocolors7.default.cyan("LearnHouse Setup Wizard"));
  await checkPrerequisites();
  let resolvedDir = "";
  let domainConfig = null;
  let dbConfig = null;
  let orgConfig = null;
  let adminConfig = null;
  let featuresConfig = null;
  let step = 0;
  const totalSteps = STEP_NAMES.length;
  while (step < totalSteps) {
    switch (step) {
      case 0: {
        v2.step(import_picocolors7.default.cyan(`Step 1/${totalSteps}`) + " Install Directory");
        const result = await stepInstallDir();
        if (result === BACK) {
          step = Math.max(0, step - 1);
          break;
        }
        resolvedDir = result;
        step++;
        break;
      }
      case 1: {
        domainConfig = await stepDomain();
        const nav = await confirmOrBack("Domain configured. Continue?");
        if (nav === BACK) {
          step--;
          break;
        }
        step++;
        break;
      }
      case 2: {
        dbConfig = await stepDatabase();
        const nav = await confirmOrBack("Database configured. Continue?");
        if (nav === BACK) {
          step--;
          break;
        }
        step++;
        break;
      }
      case 3: {
        orgConfig = await stepOrganization();
        const nav = await confirmOrBack("Organization configured. Continue?");
        if (nav === BACK) {
          step--;
          break;
        }
        step++;
        break;
      }
      case 4: {
        adminConfig = await stepAdmin();
        const nav = await confirmOrBack("Admin account configured. Continue?");
        if (nav === BACK) {
          step--;
          break;
        }
        step++;
        break;
      }
      case 5: {
        featuresConfig = await stepFeatures();
        step++;
        break;
      }
    }
  }
  const deploymentId = crypto3.randomBytes(4).toString("hex");
  const config = {
    deploymentId,
    installDir: resolvedDir,
    ...domainConfig,
    ...dbConfig,
    ...orgConfig,
    ...adminConfig,
    ...featuresConfig
  };
  const protocol = config.useHttps ? "https" : "http";
  const portSuffix = config.useHttps && config.httpPort === 443 || !config.useHttps && config.httpPort === 80 ? "" : `:${config.httpPort}`;
  const url = `${protocol}://${config.domain}${portSuffix}`;
  v2.step("Configuration Summary");
  v2.message([
    `  ${import_picocolors7.default.dim("Directory:")}     ${resolvedDir}`,
    `  ${import_picocolors7.default.dim("URL:")}           ${url}`,
    `  ${import_picocolors7.default.dim("HTTPS:")}         ${config.autoSsl ? "Auto SSL (Caddy)" : config.useHttps ? "Manual" : "Disabled"}`,
    `  ${import_picocolors7.default.dim("Database:")}      ${config.useExternalDb ? "External" : config.useAiDatabase ? "Local (Docker, AI-enabled)" : "Local (Docker)"}`,
    `  ${import_picocolors7.default.dim("Redis:")}         ${config.useExternalRedis ? "External" : "Local (Docker)"}`,
    `  ${import_picocolors7.default.dim("Organization:")} ${config.orgName}`,
    `  ${import_picocolors7.default.dim("Admin:")}        ${config.adminEmail}`,
    `  ${import_picocolors7.default.dim("AI:")}           ${config.aiEnabled ? "Enabled" : "Disabled"}`,
    `  ${import_picocolors7.default.dim("Email:")}        ${config.emailEnabled ? "Enabled" : "Disabled"}`,
    `  ${import_picocolors7.default.dim("S3 Storage:")}   ${config.s3Enabled ? "Enabled" : "Disabled"}`,
    `  ${import_picocolors7.default.dim("Google OAuth:")} ${config.googleOAuthEnabled ? "Enabled" : "Disabled"}`,
    `  ${import_picocolors7.default.dim("Unsplash:")}     ${config.unsplashEnabled ? "Enabled" : "Disabled"}`
  ].join("\n"));
  let confirmed = false;
  while (!confirmed) {
    const action = await le({
      message: "What would you like to do?",
      options: [
        { value: "confirm", label: "Proceed with this configuration" },
        { value: "edit", label: import_picocolors7.default.dim("Go back and edit a step") },
        { value: "cancel", label: import_picocolors7.default.dim("Cancel setup") }
      ]
    });
    if (lD(action) || action === "cancel") {
      he("Setup cancelled.");
      process.exit(0);
    }
    if (action === "edit") {
      const stepChoice = await le({
        message: "Which step do you want to edit?",
        options: STEP_NAMES.map((name, i) => ({ value: i, label: `${i + 1}. ${name}` }))
      });
      if (lD(stepChoice)) continue;
      const idx = stepChoice;
      switch (idx) {
        case 0: {
          v2.step(import_picocolors7.default.cyan(`Step 1/${totalSteps}`) + " Install Directory");
          const result = await stepInstallDir();
          if (result !== BACK) {
            resolvedDir = result;
            config.installDir = result;
          }
          break;
        }
        case 1: {
          domainConfig = await stepDomain();
          Object.assign(config, domainConfig);
          break;
        }
        case 2: {
          dbConfig = await stepDatabase();
          Object.assign(config, dbConfig);
          break;
        }
        case 3: {
          orgConfig = await stepOrganization();
          Object.assign(config, orgConfig);
          break;
        }
        case 4: {
          adminConfig = await stepAdmin();
          Object.assign(config, adminConfig);
          break;
        }
        case 5: {
          featuresConfig = await stepFeatures();
          Object.assign(config, featuresConfig);
          break;
        }
      }
      const p2 = config.useHttps ? "https" : "http";
      const ps2 = config.useHttps && config.httpPort === 443 || !config.useHttps && config.httpPort === 80 ? "" : `:${config.httpPort}`;
      const url2 = `${p2}://${config.domain}${ps2}`;
      v2.step("Updated Configuration Summary");
      v2.message([
        `  ${import_picocolors7.default.dim("Directory:")}     ${config.installDir}`,
        `  ${import_picocolors7.default.dim("URL:")}           ${url2}`,
        `  ${import_picocolors7.default.dim("HTTPS:")}         ${config.autoSsl ? "Auto SSL (Caddy)" : config.useHttps ? "Manual" : "Disabled"}`,
        `  ${import_picocolors7.default.dim("Database:")}      ${config.useExternalDb ? "External" : config.useAiDatabase ? "Local (Docker, AI-enabled)" : "Local (Docker)"}`,
        `  ${import_picocolors7.default.dim("Redis:")}         ${config.useExternalRedis ? "External" : "Local (Docker)"}`,
        `  ${import_picocolors7.default.dim("Organization:")} ${config.orgName}`,
        `  ${import_picocolors7.default.dim("Admin:")}        ${config.adminEmail}`,
        `  ${import_picocolors7.default.dim("AI:")}           ${config.aiEnabled ? "Enabled" : "Disabled"}`,
        `  ${import_picocolors7.default.dim("Email:")}        ${config.emailEnabled ? "Enabled" : "Disabled"}`,
        `  ${import_picocolors7.default.dim("S3 Storage:")}   ${config.s3Enabled ? "Enabled" : "Disabled"}`,
        `  ${import_picocolors7.default.dim("Google OAuth:")} ${config.googleOAuthEnabled ? "Enabled" : "Disabled"}`,
        `  ${import_picocolors7.default.dim("Unsplash:")}     ${config.unsplashEnabled ? "Enabled" : "Disabled"}`
      ].join("\n"));
    } else {
      confirmed = true;
    }
  }
  const s0 = _2();
  s0.start("Resolving LearnHouse image version");
  const { image: appImage, isLatest } = await resolveAppImage();
  s0.stop(`Using image: ${appImage}`);
  if (isLatest) {
    v2.warn("No versioned image found \u2014 using :latest tag. Pin to a version for stability.");
  }
  const s = _2();
  s.start("Generating configuration files");
  const finalDir = config.installDir;
  fs2.mkdirSync(finalDir, { recursive: true });
  fs2.mkdirSync(path2.join(finalDir, "extra"), { recursive: true });
  fs2.writeFileSync(path2.join(finalDir, "docker-compose.yml"), generateDockerCompose(config, appImage));
  fs2.writeFileSync(path2.join(finalDir, ".env"), generateEnvFile(config));
  if (config.autoSsl) {
    fs2.writeFileSync(path2.join(finalDir, "extra", "Caddyfile"), generateCaddyfile(config));
  } else {
    fs2.writeFileSync(path2.join(finalDir, "extra", "nginx.prod.conf"), generateNginxConf());
  }
  writeConfig(config);
  s.stop("Configuration files generated");
  const startNow = await ce({
    message: "Start LearnHouse now?",
    initialValue: true
  });
  if (lD(startNow)) {
    he();
    process.exit(0);
  }
  const finalProtocol = config.useHttps ? "https" : "http";
  const finalPortSuffix = config.useHttps && config.httpPort === 443 || !config.useHttps && config.httpPort === 80 ? "" : `:${config.httpPort}`;
  const finalUrl = `${finalProtocol}://${config.domain}${finalPortSuffix}`;
  if (startNow) {
    v2.step("Starting LearnHouse");
    const s2 = _2();
    s2.start("Pulling images and starting services (this may take a few minutes)");
    try {
      dockerComposeUp(finalDir);
      s2.stop("Services started");
    } catch (err) {
      s2.stop("Failed to start services");
      v2.error("Docker Compose failed. Check the output above for details.");
      v2.info(`You can manually start with: cd ${finalDir} && docker compose up -d`);
      process.exit(1);
    }
    const s3 = _2();
    s3.start("Waiting for LearnHouse to be ready (up to 3 minutes)");
    const healthy = await waitForHealth(`http://localhost:${config.httpPort}`);
    if (healthy) {
      s3.stop("LearnHouse is ready!");
    } else {
      s3.stop("Health check timed out");
      v2.warn("LearnHouse may still be starting. Check status with:");
      v2.message(`  cd ${finalDir} && docker compose ps`);
    }
    v2.success(import_picocolors7.default.green(import_picocolors7.default.bold("LearnHouse is installed!")));
    v2.message([
      "",
      `  ${import_picocolors7.default.cyan("URL:")}       ${finalUrl}`,
      `  ${import_picocolors7.default.cyan("Admin:")}     ${config.adminEmail}`,
      `  ${import_picocolors7.default.cyan("Password:")}  ${config.adminPassword}`,
      "",
      `  ${import_picocolors7.default.dim("Management commands:")}`,
      `  ${import_picocolors7.default.dim("$")} npx learnhouse start    ${import_picocolors7.default.dim("Start services")}`,
      `  ${import_picocolors7.default.dim("$")} npx learnhouse stop     ${import_picocolors7.default.dim("Stop services")}`,
      `  ${import_picocolors7.default.dim("$")} npx learnhouse logs     ${import_picocolors7.default.dim("View logs")}`,
      `  ${import_picocolors7.default.dim("$")} npx learnhouse config   ${import_picocolors7.default.dim("Show configuration")}`,
      `  ${import_picocolors7.default.dim("$")} npx learnhouse backup   ${import_picocolors7.default.dim("Backup & restore")}`,
      `  ${import_picocolors7.default.dim("$")} npx learnhouse deployments ${import_picocolors7.default.dim("Manage deployments")}`,
      `  ${import_picocolors7.default.dim("$")} npx learnhouse doctor   ${import_picocolors7.default.dim("Diagnose issues")}`,
      `  ${import_picocolors7.default.dim("$")} npx learnhouse shell    ${import_picocolors7.default.dim("Container shell")}`,
      ""
    ].join("\n"));
  } else {
    v2.info(`Files have been generated in ${finalDir}`);
    v2.message(`  Start later with: cd ${finalDir} && docker compose up -d`);
  }
  ge(import_picocolors7.default.dim("Happy teaching!"));
}

// src/commands/start.ts
var import_picocolors8 = __toESM(require_picocolors(), 1);
async function startCommand() {
  const dir = findInstallDir();
  const config = readConfig(dir);
  if (!config) {
    v2.error("No LearnHouse installation found in the current directory.");
    v2.info("Run `npx learnhouse` to set up a new installation.");
    process.exit(1);
  }
  pe(import_picocolors8.default.cyan("Starting LearnHouse"));
  try {
    dockerComposeUp(config.installDir);
    v2.success("LearnHouse is running!");
  } catch {
    v2.error("Failed to start services. Check Docker output above.");
    process.exit(1);
  }
}

// src/commands/stop.ts
var import_picocolors9 = __toESM(require_picocolors(), 1);
async function stopCommand() {
  const dir = findInstallDir();
  const config = readConfig(dir);
  if (!config) {
    v2.error("No LearnHouse installation found in the current directory.");
    process.exit(1);
  }
  pe(import_picocolors9.default.cyan("Stopping LearnHouse"));
  try {
    dockerComposeDown(config.installDir);
    v2.success("LearnHouse stopped.");
  } catch {
    v2.error("Failed to stop services. Check Docker output above.");
    process.exit(1);
  }
}

// src/commands/logs.ts
async function logsCommand() {
  const dir = findInstallDir();
  const config = readConfig(dir);
  v2.info("Streaming logs (Ctrl+C to stop)...");
  if (config?.installDir) {
    try {
      const { execSync: execSync6 } = await import("child_process");
      const ps = execSync6("docker compose ps -q", { cwd: config.installDir, stdio: "pipe" }).toString().trim();
      if (ps) {
        dockerComposeLogs(config.installDir);
        return;
      }
    } catch {
    }
  }
  const id = config?.deploymentId || autoDetectDeploymentId();
  if (!id) {
    v2.error("No LearnHouse containers found. Start services first.");
    process.exit(1);
  }
  const containers = listDeploymentContainers(id).filter((c2) => c2.status.toLowerCase().startsWith("up"));
  if (containers.length === 0) {
    v2.error("No running containers found. Start services first.");
    process.exit(1);
  }
  dockerLogsMulti(containers.map((c2) => c2.name));
}

// src/commands/config.ts
var import_picocolors10 = __toESM(require_picocolors(), 1);
async function configCommand() {
  const dir = findInstallDir();
  const config = readConfig(dir);
  if (!config) {
    v2.error("No LearnHouse installation found in the current directory.");
    process.exit(1);
  }
  pe(import_picocolors10.default.cyan("LearnHouse Configuration"));
  const protocol = config.useHttps ? "https" : "http";
  const portSuffix = config.useHttps && config.httpPort === 443 || !config.useHttps && config.httpPort === 80 ? "" : `:${config.httpPort}`;
  v2.message([
    `  ${import_picocolors10.default.dim("Version:")}      ${config.version}`,
    `  ${import_picocolors10.default.dim("Created:")}      ${config.createdAt}`,
    `  ${import_picocolors10.default.dim("Directory:")}    ${config.installDir}`,
    `  ${import_picocolors10.default.dim("URL:")}          ${protocol}://${config.domain}${portSuffix}`,
    `  ${import_picocolors10.default.dim("Org slug:")}     ${config.orgSlug}`
  ].join("\n"));
  v2.info(import_picocolors10.default.dim(`Full config: ${dir}/learnhouse.config.json`));
  v2.info(import_picocolors10.default.dim(`Environment: ${config.installDir}/.env (contains secrets)`));
}

// src/commands/backup.ts
import fs3 from "fs";
import path3 from "path";
import { execSync as execSync2 } from "child_process";
var import_picocolors11 = __toESM(require_picocolors(), 1);
function resolveDbContainer(config) {
  const id = config.deploymentId || autoDetectDeploymentId();
  return `learnhouse-db-${id}`;
}
async function createBackup() {
  const installDir = findInstallDir();
  const config = readConfig(installDir);
  if (!config) {
    v2.error("No LearnHouse installation found. Run setup first.");
    process.exit(1);
  }
  if (config.useExternalDb) {
    v2.error("Backup is only supported for local (Docker) databases.");
    v2.info("For external databases, use your database provider's backup tools.");
    process.exit(1);
  }
  const dbContainer = resolveDbContainer(config);
  if (!isContainerRunning(dbContainer)) {
    v2.error("Database container is not running. Start services first.");
    process.exit(1);
  }
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const backupDir = path3.join(installDir, "backups");
  const backupName = `learnhouse-backup-${timestamp}`;
  const tmpDir = path3.join(backupDir, backupName);
  const archivePath = path3.join(backupDir, `${backupName}.tar.gz`);
  fs3.mkdirSync(tmpDir, { recursive: true });
  const s = _2();
  s.start("Creating database dump");
  try {
    const dumpPath = path3.join(tmpDir, "database.sql");
    dockerExecToFile(
      dbContainer,
      "pg_dump -U learnhouse learnhouse",
      dumpPath
    );
    s.stop("Database dump created");
  } catch (err) {
    s.stop("Database dump failed");
    v2.error("Failed to create database dump. Check that the database is running.");
    fs3.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }
  const envPath = path3.join(installDir, ".env");
  if (fs3.existsSync(envPath)) {
    fs3.copyFileSync(envPath, path3.join(tmpDir, ".env"));
  }
  const s2 = _2();
  s2.start("Creating archive");
  try {
    execSync2(`tar -czf "${archivePath}" -C "${backupDir}" "${backupName}"`, {
      stdio: "pipe"
    });
    s2.stop("Archive created");
  } catch {
    s2.stop("Archive creation failed");
    v2.error("Failed to create archive.");
    process.exit(1);
  }
  fs3.rmSync(tmpDir, { recursive: true, force: true });
  const stats = fs3.statSync(archivePath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(1);
  v2.success(import_picocolors11.default.green(import_picocolors11.default.bold("Backup complete!")));
  v2.message([
    "",
    `  ${import_picocolors11.default.dim("File:")} ${archivePath}`,
    `  ${import_picocolors11.default.dim("Size:")} ${sizeMb} MB`,
    "",
    `  ${import_picocolors11.default.dim("Restore with:")} npx learnhouse backup --restore ${archivePath}`,
    ""
  ].join("\n"));
}
async function restoreBackup(archivePath) {
  if (!fs3.existsSync(archivePath)) {
    v2.error(`Backup file not found: ${archivePath}`);
    process.exit(1);
  }
  const installDir = findInstallDir();
  const config = readConfig(installDir);
  if (!config) {
    v2.error("No LearnHouse installation found. Run setup first.");
    process.exit(1);
  }
  if (config.useExternalDb) {
    v2.error("Restore is only supported for local (Docker) databases.");
    v2.info("For external databases, use your database provider's restore tools.");
    process.exit(1);
  }
  const dbContainer = resolveDbContainer(config);
  if (!isContainerRunning(dbContainer)) {
    v2.error("Database container is not running. Start services first.");
    process.exit(1);
  }
  v2.warn(import_picocolors11.default.yellow("This will overwrite the current database with the backup data."));
  const confirm = await ce({
    message: "Are you sure you want to restore from this backup?",
    initialValue: false
  });
  if (lD(confirm) || !confirm) {
    he("Restore cancelled.");
    process.exit(0);
  }
  const tmpDir = path3.join(installDir, ".restore-tmp");
  fs3.mkdirSync(tmpDir, { recursive: true });
  const s = _2();
  s.start("Extracting backup archive");
  try {
    execSync2(`tar -xzf "${archivePath}" -C "${tmpDir}"`, { stdio: "pipe" });
    s.stop("Archive extracted");
  } catch {
    s.stop("Extraction failed");
    fs3.rmSync(tmpDir, { recursive: true, force: true });
    v2.error("Failed to extract backup archive.");
    process.exit(1);
  }
  const entries = fs3.readdirSync(tmpDir);
  const backupFolder = entries.find(
    (e2) => fs3.existsSync(path3.join(tmpDir, e2, "database.sql"))
  );
  if (!backupFolder) {
    v2.error("No database.sql found in the backup archive.");
    fs3.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }
  const dumpPath = path3.join(tmpDir, backupFolder, "database.sql");
  const s2 = _2();
  s2.start("Restoring database");
  try {
    dockerExecFromFile(
      dbContainer,
      "psql -U learnhouse -d learnhouse",
      dumpPath
    );
    s2.stop("Database restored");
  } catch {
    s2.stop("Database restore failed");
    fs3.rmSync(tmpDir, { recursive: true, force: true });
    v2.error("Failed to restore database. The backup file may be corrupted.");
    process.exit(1);
  }
  const envBackup = path3.join(tmpDir, backupFolder, ".env");
  if (fs3.existsSync(envBackup)) {
    const restoreEnv = await ce({
      message: "Backup contains a .env file. Restore it? (overwrites current .env)",
      initialValue: false
    });
    if (!lD(restoreEnv) && restoreEnv) {
      fs3.copyFileSync(envBackup, path3.join(installDir, ".env"));
      v2.info(".env file restored");
    }
  }
  fs3.rmSync(tmpDir, { recursive: true, force: true });
  v2.success(import_picocolors11.default.green(import_picocolors11.default.bold("Restore complete!")));
  v2.info("You may want to restart services: npx learnhouse stop && npx learnhouse start");
}
async function backupCommand(archivePath, options) {
  if (options?.restore && archivePath) {
    pe(import_picocolors11.default.cyan("LearnHouse Restore"));
    await restoreBackup(archivePath);
    return;
  }
  pe(import_picocolors11.default.cyan("LearnHouse Backup"));
  const action = await le({
    message: "What would you like to do?",
    options: [
      { value: "create", label: "Create a backup" },
      { value: "restore", label: "Restore from a backup" }
    ]
  });
  if (lD(action)) {
    he();
    process.exit(0);
  }
  if (action === "create") {
    await createBackup();
  } else {
    const filePath = await ae({
      message: "Path to backup archive (.tar.gz)",
      placeholder: "./backups/learnhouse-backup-*.tar.gz"
    });
    if (lD(filePath)) {
      he();
      process.exit(0);
    }
    await restoreBackup(filePath);
  }
}

// src/commands/deployments.ts
import fs4 from "fs";
import path4 from "path";
import { execSync as execSync3 } from "child_process";
var import_picocolors12 = __toESM(require_picocolors(), 1);
var SERVICES = ["learnhouse-app", "db", "redis"];
function showDeployments() {
  let psOutput;
  try {
    psOutput = execSync3(
      'docker ps -a --filter "name=learnhouse-app-" --format "{{.Names}}\\t{{.Status}}\\t{{.Image}}"',
      { stdio: "pipe" }
    ).toString().trim();
  } catch {
    v2.error("Failed to query Docker. Is Docker running?");
    process.exit(1);
  }
  if (!psOutput) {
    v2.info("No LearnHouse deployments found.");
    v2.message(import_picocolors12.default.dim("  Run npx learnhouse setup to create one."));
    return;
  }
  const deployments = /* @__PURE__ */ new Map();
  let allOutput;
  try {
    allOutput = execSync3(
      'docker ps -a --filter "name=learnhouse-" --format "{{.Names}}\\t{{.Status}}\\t{{.Image}}"',
      { stdio: "pipe" }
    ).toString().trim();
  } catch {
    allOutput = psOutput;
  }
  for (const line of allOutput.split("\n")) {
    if (!line.trim()) continue;
    const [name, status, image] = line.split("	");
    const match = name.match(/learnhouse-\w+-([a-f0-9]+)$/);
    if (!match) continue;
    const id = match[1];
    if (!deployments.has(id)) {
      deployments.set(id, { id, containers: [] });
    }
    deployments.get(id).containers.push({ name, status, image });
  }
  v2.info(`Found ${import_picocolors12.default.bold(String(deployments.size))} deployment${deployments.size === 1 ? "" : "s"}`);
  console.log();
  for (const [id, dep] of deployments) {
    const running = dep.containers.filter((c2) => c2.status.toLowerCase().startsWith("up")).length;
    const total = dep.containers.length;
    const statusColor = running === total ? import_picocolors12.default.green : running > 0 ? import_picocolors12.default.yellow : import_picocolors12.default.red;
    const statusText = statusColor(`${running}/${total} running`);
    console.log(`  ${import_picocolors12.default.bold(import_picocolors12.default.white(`Deployment ${id}`))}  ${statusText}`);
    console.log();
    for (const c2 of dep.containers) {
      const isUp = c2.status.toLowerCase().startsWith("up");
      const icon = isUp ? import_picocolors12.default.green("\u25CF") : import_picocolors12.default.red("\u25CF");
      const svcName = c2.name.replace(`-${id}`, "");
      console.log(`    ${icon}  ${import_picocolors12.default.white(svcName.padEnd(24))} ${import_picocolors12.default.dim(c2.status)}`);
    }
    console.log();
  }
}
function parseMemLimit(composePath) {
  const content = fs4.readFileSync(composePath, "utf-8");
  const limits = /* @__PURE__ */ new Map();
  let currentService = null;
  let inServices = false;
  for (const line of content.split("\n")) {
    if (line.match(/^services:\s*$/)) {
      inServices = true;
      continue;
    }
    if (inServices && line.match(/^  \w/) && line.includes(":")) {
      const match = line.match(/^\s{2}(\S+):/);
      currentService = match ? match[1] : null;
    }
    if (currentService && line.match(/^\s+mem_limit:/)) {
      const value = line.split(":")[1].trim();
      limits.set(currentService, value);
    }
  }
  return limits;
}
function setMemLimit(content, service, limit) {
  const lines = content.split("\n");
  const result = [];
  let currentService = null;
  let inServices = false;
  let serviceIndent = 0;
  let insertedForService = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^services:\s*$/)) {
      inServices = true;
      result.push(line);
      continue;
    }
    if (inServices && line.match(/^  \w/) && line.includes(":")) {
      const match = line.match(/^(\s{2})(\S+):/);
      if (match) {
        currentService = match[2];
        serviceIndent = match[1].length;
        insertedForService = false;
      }
    }
    if (currentService === service && line.match(/^\s+mem_limit:/)) {
      result.push(line.replace(/mem_limit:.*/, `mem_limit: ${limit}`));
      insertedForService = true;
      continue;
    }
    if (currentService === service && !insertedForService && line.match(/^\s+container_name:/)) {
      result.push(line);
      result.push(`${" ".repeat(serviceIndent + 2)}mem_limit: ${limit}`);
      insertedForService = true;
      continue;
    }
    result.push(line);
  }
  return result.join("\n");
}
async function scaleResources() {
  const dir = findInstallDir();
  const config = readConfig(dir);
  if (!config) {
    v2.error("No LearnHouse installation found. Run setup first.");
    process.exit(1);
  }
  v2.step("Current Resource Usage");
  try {
    const stats = dockerStats(config.installDir);
    v2.message(import_picocolors12.default.dim(stats.trim()));
  } catch {
    try {
      const running = listDeploymentContainers(config.deploymentId).filter((c2) => c2.status.toLowerCase().startsWith("up")).map((c2) => c2.name);
      if (running.length > 0) {
        const stats = dockerStatsForContainers(running);
        v2.message(import_picocolors12.default.dim(stats.trim()));
      } else {
        v2.warn("No running containers found.");
      }
    } catch {
      v2.warn("Could not retrieve current stats. Services may not be running.");
    }
  }
  const composePath = path4.join(config.installDir, "docker-compose.yml");
  if (!fs4.existsSync(composePath)) {
    v2.error("docker-compose.yml not found.");
    process.exit(1);
  }
  let composeContent = fs4.readFileSync(composePath, "utf-8");
  const currentLimits = parseMemLimit(composePath);
  v2.step("Set Memory Limits");
  v2.info(import_picocolors12.default.dim("Examples: 256m, 512m, 1g, 2g (leave empty to skip)"));
  let changed = false;
  for (const service of SERVICES) {
    const current = currentLimits.get(service);
    const label = current ? `Memory limit for ${import_picocolors12.default.bold(service)} (current: ${current})` : `Memory limit for ${import_picocolors12.default.bold(service)} (not set)`;
    const value = await ae({
      message: label,
      placeholder: current || "e.g. 512m",
      defaultValue: ""
    });
    if (lD(value)) {
      he();
      process.exit(0);
    }
    const trimmed = value.trim();
    if (trimmed && trimmed.match(/^\d+[mgMG]$/)) {
      composeContent = setMemLimit(composeContent, service, trimmed);
      changed = true;
      v2.success(`${service}: ${trimmed}`);
    } else if (trimmed) {
      v2.warn(`Invalid format "${trimmed}" \u2014 skipping. Use format like 512m or 1g.`);
    }
  }
  if (!changed) {
    v2.info("No changes made.");
    return;
  }
  fs4.writeFileSync(composePath, composeContent);
  v2.success("docker-compose.yml updated");
  const restart = await ce({
    message: "Restart services to apply limits?",
    initialValue: false
  });
  if (!lD(restart) && restart) {
    const s = _2();
    s.start("Restarting services");
    try {
      dockerComposeDown(config.installDir);
      dockerComposeUp(config.installDir);
      s.stop("Services restarted");
    } catch {
      s.stop("Restart failed");
      v2.error("Failed to restart services. Check Docker output above.");
    }
  }
}
async function deploymentsCommand() {
  pe(import_picocolors12.default.cyan("LearnHouse Deployments"));
  const action = await le({
    message: "What would you like to do?",
    options: [
      { value: "view", label: "View deployments" },
      { value: "scale", label: "Set resource limits" }
    ]
  });
  if (lD(action)) {
    he();
    process.exit(0);
  }
  if (action === "view") {
    showDeployments();
  } else {
    await scaleResources();
  }
  ge(import_picocolors12.default.dim("Done"));
}

// src/commands/doctor.ts
import fs5 from "fs";
import path5 from "path";
import { execSync as execSync4 } from "child_process";
var import_picocolors13 = __toESM(require_picocolors(), 1);
function pass(msg) {
  console.log(`  ${import_picocolors13.default.green("\u2713")} ${msg}`);
}
function warn(msg, fix) {
  console.log(`  ${import_picocolors13.default.yellow("!")} ${msg}`);
  if (fix) console.log(`    ${import_picocolors13.default.dim(`Fix: ${fix}`)}`);
}
function fail(msg, fix) {
  console.log(`  ${import_picocolors13.default.red("\u2717")} ${msg}`);
  if (fix) console.log(`    ${import_picocolors13.default.dim(`Fix: ${fix}`)}`);
}
var REQUIRED_ENV_VARS = [
  "LEARNHOUSE_DOMAIN",
  "LEARNHOUSE_SQL_CONNECTION_STRING",
  "LEARNHOUSE_REDIS_CONNECTION_STRING",
  "LEARNHOUSE_AUTH_JWT_SECRET_KEY",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL"
];
var SECRET_ENV_VARS = [
  "LEARNHOUSE_AUTH_JWT_SECRET_KEY",
  "NEXTAUTH_SECRET",
  "POSTGRES_PASSWORD"
];
async function doctorCommand() {
  const dir = findInstallDir();
  const config = readConfig(dir);
  pe(import_picocolors13.default.cyan("LearnHouse Doctor"));
  v2.step("Docker Environment");
  if (!isDockerInstalled()) {
    fail("Docker not installed", "Install Docker: https://docs.docker.com/get-docker/");
    ge(import_picocolors13.default.red("Cannot continue without Docker"));
    process.exit(1);
  }
  pass("Docker installed");
  if (!isDockerRunning()) {
    fail("Docker daemon not running", "Start Docker Desktop or run: sudo systemctl start docker");
    ge(import_picocolors13.default.red("Cannot continue without Docker running"));
    process.exit(1);
  }
  pass("Docker daemon running");
  if (isDockerComposeV2()) {
    pass("Docker Compose v2 available");
  } else {
    fail("Docker Compose v2 not found", "Update Docker Desktop or install docker-compose-plugin");
  }
  if (!config) {
    v2.warn("No LearnHouse installation found. Skipping deployment checks.");
    ge(import_picocolors13.default.dim("Done"));
    return;
  }
  const id = config.deploymentId || autoDetectDeploymentId();
  const installDir = dir;
  v2.step("Containers");
  const containers = listDeploymentContainers(id);
  if (containers.length === 0) {
    warn("No containers found", "Run: npx learnhouse start");
  } else {
    for (const c2 of containers) {
      const isUp = c2.status.toLowerCase().startsWith("up");
      const svcName = c2.name.replace(`-${id}`, "");
      if (isUp) {
        pass(`${svcName} running`);
      } else if (c2.status.toLowerCase().includes("restarting")) {
        fail(`${svcName} is restarting`, "Check logs: npx learnhouse logs");
      } else {
        fail(`${svcName} \u2014 ${c2.status}`, "Run: npx learnhouse start");
      }
    }
  }
  v2.step("Restart Counts");
  for (const c2 of containers) {
    const count = getContainerRestartCount(c2.name);
    const svcName = c2.name.replace(`-${id}`, "");
    if (count > 3) {
      warn(`${svcName} has restarted ${count} times`, "Check container logs for crash reasons");
    } else {
      pass(`${svcName} \u2014 ${count} restarts`);
    }
  }
  v2.step("Network");
  const portFree = await checkPort(config.httpPort);
  if (portFree) {
    pass(`Port ${config.httpPort} is available`);
  } else {
    const hasRunning = containers.some((c2) => c2.status.toLowerCase().startsWith("up"));
    if (hasRunning) {
      pass(`Port ${config.httpPort} in use (by LearnHouse services)`);
    } else {
      warn(`Port ${config.httpPort} is in use by another process`, `Free the port or change HTTP_PORT in .env`);
    }
  }
  if (config.domain !== "localhost" && !config.domain.startsWith("127.")) {
    try {
      const { promises: dns } = await import("dns");
      await dns.resolve(config.domain);
      pass(`DNS resolves for ${config.domain}`);
    } catch {
      warn(`DNS resolution failed for ${config.domain}`, "Check your DNS settings or /etc/hosts");
    }
  }
  v2.step("Disk");
  try {
    const dfOutput = execSync4("df -h . | tail -1 | awk '{print $4}'", {
      stdio: "pipe",
      cwd: installDir
    }).toString().trim();
    const sizeStr = dfOutput.toLowerCase();
    const numericVal = parseFloat(sizeStr);
    if (sizeStr.includes("g") && numericVal < 1) {
      warn(`Low disk space: ${dfOutput} available`, "Free up disk space or docker system prune");
    } else if (sizeStr.includes("m")) {
      warn(`Low disk space: ${dfOutput} available`, "Free up disk space or docker system prune");
    } else {
      pass(`Disk space available: ${dfOutput}`);
    }
  } catch {
    warn("Could not check disk space");
  }
  try {
    const diskUsage = getDockerDiskUsage();
    v2.message(import_picocolors13.default.dim(diskUsage.trim()));
  } catch {
  }
  v2.step("Log Analysis");
  const errorPatterns = /ERROR|FATAL|Traceback/i;
  for (const c2 of containers) {
    if (!isContainerRunning(c2.name)) continue;
    try {
      const logs = getContainerLogs(c2.name, 50);
      const errorLines = logs.split("\n").filter((l2) => errorPatterns.test(l2));
      const svcName = c2.name.replace(`-${id}`, "");
      if (errorLines.length > 0) {
        warn(`${svcName} \u2014 ${errorLines.length} error(s) in last 50 log lines`);
        for (const line of errorLines.slice(0, 3)) {
          console.log(`    ${import_picocolors13.default.dim(line.trim().slice(0, 120))}`);
        }
      } else {
        pass(`${svcName} \u2014 no errors in recent logs`);
      }
    } catch {
      warn(`Could not read logs for ${c2.name}`);
    }
  }
  v2.step("Environment File");
  const envPath = path5.join(installDir, ".env");
  if (!fs5.existsSync(envPath)) {
    fail(".env file missing", "Run setup again: npx learnhouse setup");
  } else {
    const envContent = fs5.readFileSync(envPath, "utf-8");
    const envMap = /* @__PURE__ */ new Map();
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      envMap.set(trimmed.slice(0, eqIdx), trimmed.slice(eqIdx + 1));
    }
    let envOk = true;
    for (const key of REQUIRED_ENV_VARS) {
      if (!envMap.has(key) || !envMap.get(key)) {
        fail(`Missing or empty: ${key}`);
        envOk = false;
      }
    }
    for (const key of SECRET_ENV_VARS) {
      const val = envMap.get(key) || "";
      if (val && val.length < 8) {
        warn(`${key} seems too short (${val.length} chars)`, "Use a stronger secret");
        envOk = false;
      }
    }
    if (envOk) {
      pass("All required environment variables present");
    }
  }
  v2.step("Image Freshness");
  for (const c2 of containers) {
    try {
      const localDigest = execSync4(
        `docker inspect --format '{{.Image}}' ${c2.name}`,
        { stdio: "pipe" }
      ).toString().trim();
      const svcName = c2.name.replace(`-${id}`, "");
      pass(`${svcName} \u2014 image: ${localDigest.slice(7, 19)}`);
    } catch {
    }
  }
  console.log();
  ge(import_picocolors13.default.dim("Diagnosis complete"));
}

// src/commands/shell.ts
var import_picocolors14 = __toESM(require_picocolors(), 1);
async function shellCommand() {
  const dir = findInstallDir();
  const config = readConfig(dir);
  if (!config) {
    v2.error("No LearnHouse installation found. Run setup first.");
    process.exit(1);
  }
  const id = config.deploymentId || autoDetectDeploymentId();
  const containers = listDeploymentContainers(id || void 0).filter((c2) => c2.status.toLowerCase().startsWith("up"));
  if (containers.length === 0) {
    v2.error("No running containers found. Start services first.");
    process.exit(1);
  }
  const selected = await le({
    message: "Select a container",
    options: containers.map((c2) => ({
      value: c2.name,
      label: `${c2.name.replace(`-${id}`, "")} ${import_picocolors14.default.dim(`(${c2.name})`)}`
    }))
  });
  if (lD(selected)) {
    he();
    process.exit(0);
  }
  v2.info(`Connecting to ${selected}... (type "exit" to leave)`);
  dockerExecInteractive(selected, "/bin/sh");
}

// src/commands/dev.ts
import { spawn as spawn2, execSync as execSync5 } from "child_process";
import * as crypto4 from "crypto";
var import_picocolors15 = __toESM(require_picocolors(), 1);
import * as path6 from "path";
import * as fs6 from "fs";
var SESSION_ID = crypto4.randomBytes(4).toString("hex");
function findProjectRoot() {
  let dir = process.cwd();
  while (true) {
    if (fs6.existsSync(path6.join(dir, "dev", "docker-compose.yml")) && fs6.existsSync(path6.join(dir, "apps", "api")) && fs6.existsSync(path6.join(dir, "apps", "web"))) {
      return dir;
    }
    const parent = path6.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForHealth2(label, command, args, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      execSync5([command, ...args].join(" "), { stdio: "pipe", timeout: 5e3 });
      return true;
    } catch {
      await sleep(1e3);
    }
  }
  return false;
}
var CONTROLS_BAR = import_picocolors15.default.dim("\u2500".repeat(60)) + "\n" + import_picocolors15.default.dim("  ") + import_picocolors15.default.bold("ra") + import_picocolors15.default.dim(" restart api  ") + import_picocolors15.default.bold("rw") + import_picocolors15.default.dim(" restart web  ") + import_picocolors15.default.bold("rb") + import_picocolors15.default.dim(" restart both  ") + import_picocolors15.default.bold("q") + import_picocolors15.default.dim(" quit") + "\n" + import_picocolors15.default.dim("\u2500".repeat(60));
var lineCount = 0;
var CONTROLS_INTERVAL = 50;
function printControls() {
  process.stdout.write("\n" + CONTROLS_BAR + "\n\n");
  lineCount = 0;
}
function prefixStream(proc, label, color) {
  const prefix = color(`[${label}]`);
  const handleData = (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (line.length > 0) {
        process.stdout.write(`${prefix} ${line}
`);
        lineCount++;
        if (lineCount >= CONTROLS_INTERVAL) {
          printControls();
        }
      }
    }
  };
  proc.stdout?.on("data", handleData);
  proc.stderr?.on("data", handleData);
}
var serviceEnv = {};
function spawnService(command, args, cwd, label, color) {
  const child = spawn2(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...serviceEnv }
  });
  prefixStream(child, label, color);
  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.log(color(`[${label}]`) + ` exited with code ${code}`);
    }
  });
  return child;
}
function killProcess(child) {
  return new Promise((resolve) => {
    if (!child || child.killed || child.exitCode !== null) {
      resolve();
      return;
    }
    child.on("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed && child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 5e3);
  });
}
async function devCommand() {
  const root = findProjectRoot();
  if (!root) {
    v2.error("Not inside a LearnHouse project.");
    v2.info("Run this command from within the learnhouse monorepo (must contain dev/docker-compose.yml, apps/api/, and apps/web/).");
    process.exit(1);
  }
  if (!isDockerInstalled()) {
    v2.error("Docker is not installed. Please install Docker and try again.");
    process.exit(1);
  }
  if (!isDockerRunning()) {
    v2.error("Docker is not running. Please start Docker and try again.");
    process.exit(1);
  }
  const projectName = `learnhouse-dev-${SESSION_ID}`;
  pe(import_picocolors15.default.cyan("LearnHouse Dev Mode"));
  console.log(import_picocolors15.default.dim(`  Session: ${import_picocolors15.default.bold(SESSION_ID)}`));
  console.log();
  const email = await ae({
    message: "Admin email",
    placeholder: "admin@school.dev",
    defaultValue: "admin@school.dev"
  });
  if (lD(email)) process.exit(0);
  const password = await oe({
    message: "Admin password"
  });
  if (lD(password)) process.exit(0);
  if (!password) {
    v2.error("Password is required.");
    process.exit(1);
  }
  serviceEnv = {
    FORCE_COLOR: "1",
    LEARNHOUSE_OSS: "true",
    NEXT_PUBLIC_LEARNHOUSE_OSS: "true",
    LEARNHOUSE_INITIAL_ADMIN_EMAIL: email,
    LEARNHOUSE_INITIAL_ADMIN_PASSWORD: password
  };
  const infraSpinner = _2();
  infraSpinner.start("Starting DB and Redis containers...");
  try {
    execSync5(`docker compose -f dev/docker-compose.yml -p ${projectName} up -d`, {
      cwd: root,
      stdio: "pipe"
    });
    infraSpinner.stop("Containers started");
  } catch (e2) {
    infraSpinner.stop("Failed to start containers");
    v2.error(e2.stderr?.toString() || "docker compose up failed");
    process.exit(1);
  }
  const healthSpinner = _2();
  healthSpinner.start("Waiting for DB and Redis to be healthy...");
  const [dbReady, redisReady] = await Promise.all([
    waitForHealth2("DB", "docker", ["exec", "learnhouse-db-dev", "pg_isready", "-U", "learnhouse"]),
    waitForHealth2("Redis", "docker", ["exec", "learnhouse-redis-dev", "redis-cli", "ping"])
  ]);
  if (!dbReady || !redisReady) {
    healthSpinner.stop("Health checks failed");
    if (!dbReady) v2.error("Database did not become ready in time.");
    if (!redisReady) v2.error("Redis did not become ready in time.");
    process.exit(1);
  }
  healthSpinner.stop("DB and Redis are healthy");
  let apiProc = null;
  let webProc = null;
  const startApi = () => {
    return spawnService("uv", ["run", "python", "app.py"], path6.join(root, "apps", "api"), "api", import_picocolors15.default.magenta);
  };
  const startWeb = () => {
    return spawnService("pnpm", ["dev"], path6.join(root, "apps", "web"), "web", import_picocolors15.default.cyan);
  };
  apiProc = startApi();
  webProc = startWeb();
  v2.success("API and Web servers started");
  console.log();
  console.log(import_picocolors15.default.dim("  Thank you for contributing to LearnHouse!"));
  console.log();
  printControls();
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n" + import_picocolors15.default.dim("Shutting down..."));
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    await Promise.all([killProcess(apiProc), killProcess(webProc)]);
    try {
      execSync5(`docker compose -f dev/docker-compose.yml -p ${projectName} down`, {
        cwd: root,
        stdio: "pipe"
      });
      console.log(import_picocolors15.default.dim("Containers stopped."));
    } catch {
    }
    console.log(import_picocolors15.default.dim("Thanks for building with LearnHouse!"));
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let pendingR = false;
    process.stdin.on("data", async (key) => {
      if (key === "") {
        await shutdown();
        return;
      }
      if (key === "q") {
        await shutdown();
        return;
      }
      if (key === "r") {
        pendingR = true;
        setTimeout(() => {
          pendingR = false;
        }, 1e3);
        return;
      }
      if (pendingR) {
        pendingR = false;
        if (key === "a") {
          console.log(import_picocolors15.default.magenta("\n  Restarting API...\n"));
          await killProcess(apiProc);
          apiProc = startApi();
          printControls();
        } else if (key === "w") {
          console.log(import_picocolors15.default.cyan("\n  Restarting Web...\n"));
          await killProcess(webProc);
          webProc = startWeb();
          printControls();
        } else if (key === "b") {
          console.log(import_picocolors15.default.yellow("\n  Restarting both...\n"));
          await Promise.all([killProcess(apiProc), killProcess(webProc)]);
          apiProc = startApi();
          webProc = startWeb();
          printControls();
        }
      }
    });
  }
  await new Promise(() => {
  });
}

// bin/learnhouse.ts
var COMMANDS = [
  { name: "setup", desc: "Interactive setup wizard" },
  { name: "start", desc: "Start services" },
  { name: "stop", desc: "Stop services" },
  { name: "logs", desc: "Stream logs" },
  { name: "config", desc: "Show configuration" },
  { name: "backup", desc: "Backup & restore database" },
  { name: "deployments", desc: "Manage deployments & resources" },
  { name: "doctor", desc: "Diagnose issues" },
  { name: "shell", desc: "Container shell access" },
  { name: "dev", desc: "Development mode" }
];
async function showWelcome() {
  await printBanner();
  console.log(import_picocolors16.default.bold(import_picocolors16.default.white("  Available commands:\n")));
  for (const cmd of COMMANDS) {
    console.log(`    ${import_picocolors16.default.cyan(cmd.name.padEnd(14))} ${import_picocolors16.default.dim(cmd.desc)}`);
  }
  console.log();
  console.log(import_picocolors16.default.dim("  Run a command with: npx learnhouse <command>"));
  console.log(import_picocolors16.default.dim("  Get started with:   npx learnhouse setup"));
  console.log();
}
var program2 = new Command();
program2.name("learnhouse").description("The official LearnHouse CLI \u2014 deploy, manage, and operate your LearnHouse instance").version(VERSION).action(showWelcome);
program2.command("setup").description("Interactive setup wizard for LearnHouse").action(setupCommand);
program2.command("start").description("Start LearnHouse services").action(startCommand);
program2.command("stop").description("Stop LearnHouse services").action(stopCommand);
program2.command("logs").description("Stream logs from LearnHouse services").action(logsCommand);
program2.command("config").description("Show current LearnHouse configuration").action(configCommand);
program2.command("backup").description("Backup & restore LearnHouse database").argument("[archive]", "Path to backup archive for restore").option("--restore", "Restore from a backup archive").action(backupCommand);
program2.command("deployments").description("Manage deployments & resource limits").action(deploymentsCommand);
program2.command("doctor").description("Diagnose common issues with LearnHouse").action(doctorCommand);
program2.command("shell").description("Open a shell in a LearnHouse container").action(shellCommand);
program2.command("dev").description("Start development environment (DB + Redis in Docker, API + Web locally)").action(devCommand);
var updateCheck = checkForUpdates();
program2.parseAsync().then(() => updateCheck.catch(() => {
}));
