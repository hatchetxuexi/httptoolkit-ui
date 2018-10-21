import * as React from 'react';

import { styled } from '../../styles'
import { HttpExchange } from "../../model/store";
import { ClearArrayButton } from './clear-button';

const RequestCounter = styled((props: {
    className?: string,
    exchanges: HttpExchange[]
}) =>
    <div className={props.className}>
        <span className='count'>{props.exchanges.length}</span>
        <span className='label'>requests</span>
    </div>
)`
    min-width: 120px;

    .count {
        font-size: 20px;
        font-weight: bold;
    }

    .label {
        font-size: ${p => p.theme.textSize};
        font-weight: lighter;
        margin-left: 5px;
    }
`;

export const TableFooter = styled((props: {
    className?: string,
    onClear: () => void,
    exchanges: HttpExchange[]
}) => <div className={props.className}>
    <RequestCounter exchanges={props.exchanges} />
    <ClearArrayButton array={props.exchanges} onClear={props.onClear} />
</div>)`
    position: absolute;
    bottom: 0;

    width: 100%;
    height: 40px;
    background-color: ${p => p.theme.mainBackground};

    display: flex;
    align-items: center;
    justify-content: space-around;
`;