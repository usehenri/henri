// Type definitions for @usehenri/react/forms
//
// The components are `(props) => any` on purpose: the package does not depend
// on `@types/react`, and a function returning `any` is still a valid JSX
// element type, so props are checked either way.

/**
 * A validator.js rule name mapped to its options: `true` to run it with none,
 * anything else is passed as the second argument
 * (`{ isLength: { min: 3 }, isEmail: true }`).
 */
export type Rules = Record<string, unknown>;

/** What `useForm()` answers: the state of the surrounding `<Form>`. */
export interface FormState {
  /** Always true inside a `<Form>`; the fields warn when it is not. */
  _henriForm: boolean;
  /** The values, keyed by field name (dotted names nest). */
  data: Record<string, any>;
  /** True while a submit is in flight. */
  disabled: boolean;
  /** The form-level error: the message, `true` without one, or null. */
  error: string | true | null;
  /** The failing rule (or the server message) per field. */
  errors: Record<string, string | null>;
  /** True once a field changed. */
  modified: boolean;
  /** Registers a sanitizer for a field; the returned function removes it. */
  addSanitizer(fieldName: string, rules?: Rules): () => void;
  /** Resets the values to what `data` was. */
  clear(): void;
  handleChange(
    event: {
      target: {
        name: string;
        value?: any;
        type?: string;
        checked?: boolean;
      };
    },
    validation?: Rules
  ): void;
  handleSubmit(event?: { preventDefault?: () => void }): Promise<any> | void;
}

/** The context `Form` provides. Prefer `useForm()`. */
export declare const FormContext: any;

/** The state of the surrounding `<Form>`. */
export declare function useForm(): FormState;

/** Where a form submits: a path, or a path helper from `pathFor()`. */
export type FormAction = string | { method?: string; route?: string };

export interface FormProps {
  /** Where to submit. Cannot be combined with `handleSubmit`. */
  action?: FormAction | null;
  /** Wins over `action.method` (`post`). */
  method?: string | null;
  /** The initial values; changing it resets the form. */
  data?: Record<string, any> | null;
  /** An error to show, from outside the form. */
  error?: any;
  /** Submit yourself: `(action, sanitizedData, clear) => any`. */
  handleSubmit?:
    | ((
        action: FormAction | null,
        data: Record<string, any>,
        clear: () => void
      ) => any)
    | null;
  /** Called with the sanitized payload and the answer. */
  onSuccess?: ((data: Record<string, any>, result: any) => void) | null;
  onError?: ((message: string, error: unknown) => void) | null;
  /** The message used when the server sends none. */
  onFail?: string;
  /** Logs the payload and the result. */
  debug?: boolean;
  className?: string;
  /** Rendered as the `id` of the `<form>`. */
  name?: string;
  children?: any;
}

/**
 * A form bound to the page's `fetch`: it submits as JSON, puts the server's
 * validation errors on the fields and re-hydrates the page on success.
 */
export declare function Form(props: FormProps): any;

/** What every field shares. */
export interface FieldProps {
  /** The key in the form data (dotted names nest). */
  name: string;
  /** validator.js rules run on change. */
  validation?: Rules;
  /** validator.js rules applied to the value before it is submitted. */
  sanitation?: Rules;
  /** A message per failing rule name. */
  errorMsg?: Record<string, string>;
  baseClassName?: string;
  errorClassName?: string;
  required?: boolean;
  [prop: string]: any;
}

export interface InputProps extends FieldProps {
  /** Default `'form-control'`. */
  className?: string;
  /** Default `'text'`; `'checkbox'` binds `checked` instead of `value`. */
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}

export declare function Input(props: InputProps): any;

export interface SelectProps extends FieldProps {
  /** Strings, numbers, or objects read through `displayProp` and `id`. */
  choices?: Array<string | number | Record<string, any>>;
  /** The key holding the label of an object choice (`'name'`). */
  displayProp?: string;
  /** Renders a leading empty option. */
  placeholder?: string | null;
  className?: string;
  disabled?: boolean;
}

export declare function Select(props: SelectProps): any;

export interface RadioProps extends FieldProps {
  /** The value this button sets; it is also the `id`. */
  name: string;
  /** The field the buttons of a group share. */
  group: string;
  label?: string;
  children?: any;
  className?: string;
  disabled?: boolean;
}

export declare function Radio(props: RadioProps): any;

export interface EditorProps extends FieldProps {
  /** Quill theme (`'snow'`). */
  theme?: string;
  placeholder?: string;
}

/** A rich text field (Quill), loaded on the client only. */
export declare function Editor(props: EditorProps): any;

export interface ButtonProps {
  /** Wins over `children`. */
  label?: string;
  /** Default `'submit'`. */
  type?: string;
  className?: string;
  children?: any;
  [prop: string]: any;
}

/** A submit button, disabled while the form is submitting. */
export declare function Button(props: ButtonProps): any;

export interface FormErrorProps {
  /** Shown instead of the message. */
  children?: any;
  className?: string;
}

/** The form-level error; renders nothing when there is none. */
export declare function FormError(props: FormErrorProps): any;

/**
 * Runs one validator.js rule. Answers what the rule answers: a boolean for a
 * check, the new value for a sanitizer.
 */
export declare function Validation(
  rule: string,
  opts: unknown,
  value: unknown
): boolean | string | any;

/** Applies the registered sanitizers to a copy of the data. */
export declare function sanitize(
  data: Record<string, any>,
  sanitizers?: Record<string, Rules>
): Record<string, any>;

/** The message to show for a failing rule. */
export declare function messageFor(
  errorMsg: Record<string, string>,
  failure: unknown
): string;
