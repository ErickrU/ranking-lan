#!/usr/bin/env bash
# ============================================================================
# Ranking LAN · eliminar TODO lo desplegado en AWS
#
#   bash despliegue/eliminar.sh            # borra el stack (pide confirmacion)
#   bash despliegue/eliminar.sh --con-ecr  # ademas borra el repositorio ECR
#
# Borra: servicio ECS, cluster, ALB, target group, security groups, logs,
# rol IAM y (si existe) la distribucion de CloudFront. Con --con-ecr borra
# tambien el repositorio de imagenes. Dejar de pagar = correr este script.
# ============================================================================
set -euo pipefail

PILA="ranking-lan"
REPO="ranking-lan"
CON_ECR="no"
REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || true)}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pila)    PILA="$2"; shift 2 ;;
    --region)  REGION="$2"; shift 2 ;;
    --con-ecr) CON_ECR="si"; shift ;;
    *) echo "Parametro desconocido: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$REGION" ]] || { echo "No hay region de AWS configurada." >&2; exit 1; }

echo "Se eliminara el stack '$PILA' en $REGION (ALB, Fargate, CloudFront, logs, rol)."
[[ "$CON_ECR" == "si" ]] && echo "Tambien se eliminara el repositorio ECR '$REPO' con todas sus imagenes."
read -r -p "¿Continuar? [s/N] " RESPUESTA
[[ "$RESPUESTA" =~ ^[sS]$ ]] || { echo "Cancelado."; exit 0; }

echo "Eliminando stack (CloudFront puede tardar varios minutos)..."
aws cloudformation delete-stack --stack-name "$PILA" --region "$REGION"
aws cloudformation wait stack-delete-complete --stack-name "$PILA" --region "$REGION"
echo "Stack eliminado."

if [[ "$CON_ECR" == "si" ]]; then
  aws ecr delete-repository --repository-name "$REPO" --force --region "$REGION" >/dev/null &&
    echo "Repositorio ECR eliminado."
fi

echo "Listo: no queda infraestructura facturable de Ranking LAN."
