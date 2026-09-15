#!/usr/bin/env bash
# ============================================================================
# Ranking LAN · despliegue a AWS (ECR + Fargate + ALB, CloudFront opcional)
#
# Uso:
#   bash despliegue/desplegar.sh                     # demo, con HTTPS (CloudFront)
#   bash despliegue/desplegar.sh --clave RGAPI-...   # con datos reales de Riot
#   bash despliegue/desplegar.sh --https no          # solo ALB, sin CloudFront
#
# Es idempotente: la primera vez crea todo; las siguientes construye una nueva
# imagen, la sube y actualiza el stack (ECS hace rolling deploy).
#
# La clave se toma de --clave, o de $RIOT_API_KEY, o del .env local. Nunca se
# hornea en la imagen (.dockerignore la excluye): viaja como parametro NoEcho
# del stack y llega a la tarea como variable de entorno.
# ============================================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLANTILLA="$RAIZ/despliegue/plantilla.yaml"

# ----------------------------------------------------------------------------
# Parametros
# ----------------------------------------------------------------------------
PILA="ranking-lan"
HTTPS="si"
CLAVE="${RIOT_API_KEY:-}"
REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || true)}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pila)   PILA="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --https)  HTTPS="$2"; shift 2 ;;
    --clave)  CLAVE="$2"; shift 2 ;;
    *) echo "Parametro desconocido: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$REGION" ]] || { echo "No hay region de AWS configurada (aws configure)." >&2; exit 1; }

# Si no llego clave por flag ni por entorno, intenta el .env local (sin echo).
if [[ -z "$CLAVE" && -f "$RAIZ/.env" ]]; then
  CLAVE="$(sed -n 's/^RIOT_API_KEY=//p' "$RAIZ/.env" | head -1)"
  # La plantilla del .env.example trae una clave de relleno: ignorala.
  [[ "$CLAVE" == RGAPI-00000000-* ]] && CLAVE=""
fi

# ----------------------------------------------------------------------------
# Contexto de AWS
# ----------------------------------------------------------------------------
CUENTA="$(aws sts get-caller-identity --query Account --output text)"
REGISTRO="$CUENTA.dkr.ecr.$REGION.amazonaws.com"
REPO="ranking-lan"

echo "Cuenta $CUENTA · region $REGION · stack $PILA · https $HTTPS"
[[ -n "$CLAVE" ]] && echo "Clave de Riot: detectada (se pasa como parametro NoEcho)" \
                  || echo "Clave de Riot: no configurada -> la app corre en modo demostracion"

# ----------------------------------------------------------------------------
# Arquitectura: la imagen debe coincidir con la plataforma de Fargate
# ----------------------------------------------------------------------------
if [[ "$(uname -m)" == "arm64" || "$(uname -m)" == "aarch64" ]]; then
  ARQUITECTURA="ARM64"; PLATAFORMA="linux/arm64"
else
  ARQUITECTURA="X86_64"; PLATAFORMA="linux/amd64"
fi
echo "Imagen para $PLATAFORMA (Fargate $ARQUITECTURA)"

# ----------------------------------------------------------------------------
# ECR: crear el repositorio si no existe, construir y subir
# ----------------------------------------------------------------------------
aws ecr describe-repositories --repository-names "$REPO" --region "$REGION" >/dev/null 2>&1 ||
  aws ecr create-repository \
    --repository-name "$REPO" \
    --image-scanning-configuration scanOnPush=true \
    --region "$REGION" >/dev/null

aws ecr get-login-password --region "$REGION" |
  docker login --username AWS --password-stdin "$REGISTRO" >/dev/null

ETIQUETA="$(date +%Y%m%d-%H%M%S)"
IMAGEN="$REGISTRO/$REPO:$ETIQUETA"

echo "Construyendo $IMAGEN ..."
docker build --platform "$PLATAFORMA" -t "$IMAGEN" "$RAIZ"
docker push "$IMAGEN"

# ----------------------------------------------------------------------------
# Red: VPC por defecto y sus subredes publicas
# ----------------------------------------------------------------------------
VPC="$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text --region "$REGION")"
[[ "$VPC" != "None" ]] || { echo "No hay VPC por defecto en $REGION." >&2; exit 1; }

SUBREDES="$(aws ec2 describe-subnets \
  --filters Name=vpc-id,Values="$VPC" Name=default-for-az,Values=true \
  --query 'Subnets[].SubnetId' --output text --region "$REGION" | tr '\t' ',')"
CUANTAS="$(tr ',' '\n' <<<"$SUBREDES" | grep -c .)"
[[ "$CUANTAS" -ge 2 ]] || { echo "El ALB necesita >=2 subredes y hay $CUANTAS." >&2; exit 1; }

echo "VPC $VPC · $CUANTAS subredes"

# ----------------------------------------------------------------------------
# CloudFormation: crear o actualizar
# ----------------------------------------------------------------------------
PARAMETROS=(
  "Imagen=$IMAGEN"
  "VpcId=$VPC"
  "SubnetIds=$SUBREDES"
  "Arquitectura=$ARQUITECTURA"
  "HabilitarHttps=$HTTPS"
  "RiotApiKey=$CLAVE"
)

echo "Desplegando el stack (la primera vez tarda ~8 min; CloudFront suma unos minutos)..."
aws cloudformation deploy \
  --stack-name "$PILA" \
  --template-file "$PLANTILLA" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --region "$REGION" \
  --parameter-overrides "${PARAMETROS[@]}"

# ----------------------------------------------------------------------------
# Esperar al servicio y mostrar las URLs
# ----------------------------------------------------------------------------
echo "Esperando a que el servicio de ECS quede estable..."
aws ecs wait services-stable --cluster "$PILA" --services "$PILA" --region "$REGION"

SALIDAS="$(aws cloudformation describe-stacks --stack-name "$PILA" --region "$REGION" \
  --query 'Stacks[0].Outputs' --output json)"

valor() { node -e 'const s=JSON.parse(process.argv[1]);const o=s.find(x=>x.OutputKey===process.argv[2]);console.log(o?o.OutputValue:"")' "$SALIDAS" "$1"; }

URL_ALB="$(valor UrlAlb)"
URL_HTTPS="$(valor UrlHttps)"
DISTRIBUCION="$(valor IdDistribucion)"

# En actualizaciones, invalida la cache del borde para servir la version nueva.
if [[ -n "$DISTRIBUCION" ]]; then
  aws cloudfront create-invalidation --distribution-id "$DISTRIBUCION" \
    --paths '/*' --query 'Invalidation.Id' --output text >/dev/null &&
    echo "Cache de CloudFront invalidada."
fi

echo
echo "============================================================"
echo "  Despliegue listo"
echo "============================================================"
echo "  ALB (HTTP)        $URL_ALB"
[[ -n "$URL_HTTPS" ]] && {
  echo "  CloudFront (HTTPS) $URL_HTTPS"
  echo
  echo "  Usa la URL de CloudFront: con HTTPS el service worker,"
  echo "  el modo offline y la instalacion de la PWA funcionan."
}
echo
echo "  Salud:    ${URL_ALB}api/estado"
echo "  Eliminar: bash despliegue/eliminar.sh"
echo "============================================================"
