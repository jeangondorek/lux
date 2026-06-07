{
  description = "Lux flake";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  inputs.flake-utils.url = "github:numtide/flake-utils";

  outputs =
    {
      nixpkgs,
      flake-utils,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        lib = pkgs.lib;
      in
      {
        packages = rec {
          lux = pkgs.rustPlatform.buildRustPackage {
            name = "lux";
            src = lib.cleanSource ./.;
            cargoLock.lockFile = ./Cargo.lock;
          };

          default = lux;

          meta = {
            description = "An open-source application database engine with Redis-compatible commands";
            homepage = "https://github.com/lux-db/lux";
            license = lib.licenses.mit;
            maintainers = [ ];
          };
        };
      }
    );
}
