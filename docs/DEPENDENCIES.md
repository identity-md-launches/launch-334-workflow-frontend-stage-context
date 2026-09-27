# Vendored dependencies

Dependencies are ordinary checked-in source files, without submodules or installation hooks. These pinned archives were fetched from the upstream projects. No runtime tool needs network access after Foundry and the configured compiler are present.

| Library | Upstream version / archive | Included files | Archive SHA-256 |
| --- | --- | --- | --- |
| OpenZeppelin Contracts | [v5.0.2](https://github.com/OpenZeppelin/openzeppelin-contracts/tree/v5.0.2), `https://codeload.github.com/OpenZeppelin/openzeppelin-contracts/tar.gz/refs/tags/v5.0.2` | Unmodified ERC20, SafeERC20, ReentrancyGuard and their transitive Solidity imports, plus MIT license | `18c7b7e949b9a82dcd8cd394426c9c2636dfc263aa2317d4749dbfa0c7b3925a` |
| forge-std | [v1.9.7](https://github.com/foundry-rs/forge-std/tree/v1.9.7), `https://codeload.github.com/foundry-rs/forge-std/tar.gz/refs/tags/v1.9.7` | Complete unmodified `src/` tree and MIT/Apache licenses; tests only | `45157353ab49eab01d294565866731e599b32401757229689ee459aa26b7ee94` |

`remappings.txt` maps these sources into the compiler. No node_modules, compiler binary, dynamic library checkout, package manager, FFI or filesystem cheatcode permission is needed. The generic forge-std library includes optional helpers that are not called by this project's tests; tests use in-process Foundry state manipulation and never read or mutate environment variables.
