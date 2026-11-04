# TanStack Form

[TanStack Form](https://tanstack.com/form) accepts any Standard Schema V1 as a form or field validator. `ata-validator` implements Standard Schema natively, so a `Validator` instance plugs straight in.

## Install

```bash
npm install ata-validator @tanstack/react-form
```

## In the browser

Add the build plugin, and the code below stays as it is: [`@ata-project/unplugin`](https://github.com/ata-core/unplugin-ata) compiles `userFormSchema` at build time, the form still reads it through Standard Schema, and the validator runtime leaves the page. With Vite and React this form's validation adds 1.92 KB gzipped to the first load, against 51.08 KB for the runtime.

```js
// vite.config.js; for Next.js, withAta from '@ata-project/unplugin/next'
import ata from '@ata-project/unplugin/vite'

export default { plugins: [ata()] }
```

## Form-level validation

```tsx
import { useForm } from '@tanstack/react-form'
import { Validator } from 'ata-validator'

const userFormSchema = new Validator({
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    email: { type: 'string' },
    age: { type: 'integer', minimum: 13 },
  },
  required: ['name', 'email'],
})

export function UserForm() {
  const form = useForm({
    defaultValues: { name: '', email: '', age: 0 },
    validators: {
      onChange: userFormSchema,
    },
    onSubmit: async ({ value }) => {
      console.log(value)
    },
  })

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit() }}>
      <form.Field
        name="name"
        children={(field) => (
          <div>
            <input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            {field.state.meta.errors.length > 0 && (
              <em>{field.state.meta.errors.join(', ')}</em>
            )}
          </div>
        )}
      />
      {/* ... other fields ... */}
      <button type="submit">Save</button>
    </form>
  )
}
```

## Field-level validation

Pass a single-field Validator to a specific `form.Field`:

```tsx
const emailSchema = new Validator({ type: 'string', minLength: 5, maxLength: 200 })

<form.Field
  name="email"
  validators={{ onChange: emailSchema }}
  children={(field) => /* ... */}
/>
```

## Using compiled schemas for types

Pair TanStack Form with `ata compile` to get a type-narrowed `value` on submit:

```bash
npx ata compile schemas/user-form.json -o src/user-form.validator.mjs --name UserForm
```

```tsx
import { Validator } from 'ata-validator'
import type { UserForm } from './schemas/user-form.validator.mjs'
import userFormSchemaJson from './schemas/user-form.json' with { type: 'json' }

const userFormSchema = new Validator(userFormSchemaJson)

export function MyForm() {
  const form = useForm<UserForm>({
    defaultValues: { name: '', email: '', age: 0 },
    validators: { onChange: userFormSchema },
    onSubmit: async ({ value }) => {
      // `value` is UserForm
      saveUser(value)
    },
  })
  // ...
}
```

## Error shape

TanStack Form reads the Standard Schema `issues` array and surfaces them on `field.state.meta.errors`. Each issue has a `message` and `path`, and the form maps path to field automatically.

Default error messages come from ata's ajv-compatible defaults ("must be >= 1", "must be string", etc.). To customize, intercept in `onChangeAsync` or use a validator with `abortEarly` off and post-process.

## Notes

- Works the same with Solid / Vue / Svelte adapters of TanStack Form.
- For forms with complex cross-field rules (if/then/else), keep those in the schema; Standard Schema surfaces them as issues with the correct path.
- For very high-frequency validation (on every keystroke), consider a single `onSubmit`-level validator instead of `onChange` to keep keystroke latency low.
